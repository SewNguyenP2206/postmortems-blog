---

title: "Chuyện gì thực sự xảy ra khi một Pod giao tiếp với một Pod khác"
date: "2026-10-02"
category: "Kubernetes"
tags: ["kubernetes", "networking", "iptables", "devops"]
author: "Phú Nguyễn"
summary: "Một bài hướng dẫn thực tế, đi từ con số không về mạng (networking) trong Kubernetes — network namespaces, veth pairs, bảng định tuyến (routing tables), và cách một ClusterIP thực sự trở thành một IP Pod thật. Mọi câu lệnh trong này đều được chạy trên một cluster Kind thực tế, không phải mô phỏng."

---

Tôi từng xài MetalLB, ingress-nginx và gõ `kubectl get svc` suốt nhiều tháng trời trước khi thực sự hiểu chuyện gì xảy ra giữa lúc một Pod gửi packet (gói tin) đi và một Pod khác nhận được nó. Tôi biết cách cấu hình các thành phần. Nhưng tôi không thể giải thích được đường đi của dữ liệu.

Vì vậy, tôi ngừng việc ngồi xem các sơ đồ và bắt đầu "đọc" chính cluster của mình. Bài viết này là hành trình đó — 4 layer, mỗi layer được xác thực bằng các câu lệnh thực tế trên một cluster Kind thật, đi dần lên đến khoảnh khắc mà một ClusterIP của Service biến thành một địa chỉ Pod thực sự.

Nếu bạn muốn làm theo, bạn cần quyền truy cập `kubectl` vào bất kỳ cluster nào và có khả năng `docker exec` hoặc SSH vào một node.

## Mô hình tư duy: Một tòa chung cư

Trước khi gõ bất kỳ câu lệnh nào, hãy hình dung bức tranh tổng thể. Hãy tưởng tượng mỗi Node là một tòa chung cư, và mỗi Pod là một căn hộ bên trong đó, với địa chỉ riêng của nó.

![Sơ đồ luồng mạng giữa các Pod và node Kubernetes](blogs/image.png)

Mặc định, một căn hộ bị cô lập hoàn toàn với mọi thứ xung quanh. Để gửi hoặc nhận bất cứ thứ gì, nó cần một đường ống dẫn ra hành lang. Quầy lễ tân của tòa nhà sẽ quyết định: đối với bất kỳ thứ gì rời khỏi căn hộ, nó sẽ đi đến một căn hộ khác trong cùng tòa nhà, hay cần phải đi ra cửa chính để đến một tòa nhà hoàn toàn khác.

Mọi khái niệm bên dưới đây đều ánh xạ đến một phần của bức tranh này.

## Layer 1 — Mỗi Pod sống trong một network namespace của riêng nó

Pod không chỉ là một process — nó chạy trong network namespace của riêng mình: một bản sao hoàn toàn tách biệt của Linux networking stack (interface riêng, bảng định tuyến riêng, mọi thứ liên quan đến mạng đều riêng biệt). Mặc định, hai Pod trên cùng một node không chia sẻ không gian này; chúng bị cô lập với nhau y như hai cỗ máy vật lý khác biệt.

Bạn có thể tự chứng minh điều này. Tìm một Pod đang chạy, lấy container ID của nó, sau đó tìm PID của container đó trên node:

```bash
kubectl get pod  -n  -o jsonpath='{.status.containerStatuses[0].containerID}'
# sau đó, thao tác trên node:
crictl inspect  | grep -A2 '"pid"'

```

Bây giờ, hãy so sánh namespace của Pod với namespace của chính node đó:

```bash
readlink /proc//ns/net
readlink /proc/1/ns/net

```

Hai con số khác nhau sẽ trả về — đại diện cho hai thế giới tách biệt. Hãy nhìn trực tiếp vào bên trong namespace của Pod:

```bash
nsenter -t  -n ip addr

```

Đây chính là nơi IP của Pod — cái IP mà bạn thấy khi gõ `kubectl get pod -o wide` — thực sự tồn tại. Nó không phải là thuộc tính của node. Nó là thuộc tính của cái namespace bị cô lập này.

## Layer 2 — veth pairs: Đường ống nối giữa Pod và Node

Một namespace bị bịt kín cần đúng một con đường duy nhất để ra vào: một `veth pair` — hai virtual network interfaces (giao diện mạng ảo) luôn đi kèm với nhau thành một bộ, giống như một đường ống có hai đầu. Một đầu nằm bên trong Pod (bạn sẽ thấy nó tên là `eth0`). Đầu còn lại nằm trong namespace của node, thường có tên kiểu như `vethXXXXXXX`.

Bất cứ thứ gì được đẩy vào một đầu sẽ ngay lập tức xuất hiện ở đầu kia. Không có quá trình xử lý nào chen giữa — đó là một liên kết trực tiếp, được định nghĩa bằng phần mềm (software-defined link).

Bên trong Pod, interface này thường hiển thị `ifindex` của cái đầu đang được ghép nối với nó:

```text
2: eth0@if9: ...

```

Cái `@if9` đó báo cho bạn biết rằng đầu nối tương ứng nằm trên node có `ifindex` là 9. Xác nhận lại từ phía node:

```bash
ip link show | grep "^9:"

```

Tùy thuộc vào CNI plugin bạn dùng, cái veth này có thể được cắm vào một bridge (như kiểu Flannel) hoặc để tự do và được route thẳng tới (như kiểu kindnet — sẽ nói rõ hơn ở phần sau). Dù bằng cách nào, đây là cánh cửa duy nhất để thoát ra khỏi căn phòng kín của Pod.

## Layer 3 — Bảng định tuyến quyết định trạm kế tiếp của packet

Một khi packet thoát ra được namespace của node, node phải đưa ra quyết định: forward nó đến một Pod cục bộ (local), hay gửi nó đến một node hoàn toàn khác? Node trả lời câu hỏi này bằng đúng cách mà bất kỳ máy Linux nào trả lời câu hỏi "packet này đi đâu" — bằng cách đọc bảng định tuyến (routing table) của nó.

```bash
ip route show | grep 10.244

```

Trên một cluster chạy kindnet, bạn sẽ thấy hai loại dòng riêng biệt:

```text
10.244.2.6 dev veth8a8808c3 scope host        # một Pod duy nhất, nằm ngay tại đây
10.244.0.0/24 via 172.18.0.5 dev eth0         # một dải /24 hoàn chỉnh, nằm trên node khác

```

Dòng đầu tiên là một *host route* (`/32`, khớp chính xác một địa chỉ duy nhất) — "Cái IP Pod chính xác này đang nằm trên người tao, đẩy packet thẳng vào đường ống này đi." Dòng thứ hai là một *network route* (`/24`, khớp với toàn bộ một dải IP) — "Bất cứ thứ gì nằm trong dải này đều thuộc về node khác; hãy giao nó cho địa chỉ thật của node đó và để nó tự lo phần còn lại."

Node không cần biết chính xác Pod nào bên trong node kia đang giữ địa chỉ đó — nó chỉ cần biết phải giao packet cho tòa nhà (node) nào. Đó là toàn bộ mánh khóe ở đây: mỗi node chỉ biết chi tiết về các căn hộ của chính nó, và coi mọi node khác như một địa chỉ bưu điện duy nhất.

Đây cũng là lý do vì sao kindnet (CNI mặc định của Kind) không cần đến overlay network như VXLAN. Tất cả các node đều nằm trên cùng một Docker network phẳng (`172.18.0.0/16`), nên một node có thể ném packet trực tiếp đến IP thật của một node khác — không cần đóng gói (encapsulation). Đó là một sự tối giản đặc thù của Kind; các CNI trên môi trường production, chạy qua nhiều subnet hoặc Availability Zone thực sự, thường sẽ cần đến overlay network.

## Layer 4 — Service là một số điện thoại, không phải một căn hộ

Đây là phần khiến tôi lú lẫn lâu nhất. Lệnh `kubectl get svc` cho bạn một ClusterIP — nhưng thực tế không có ai ở nhà tại địa chỉ đó cả. Nó không nằm trong network namespace của bất kỳ Pod nào, không gắn vào bất kỳ veth nào, cũng không nằm trong bất kỳ bảng định tuyến nào như một điểm đến thực sự. Vậy làm sao một packet gửi đến đó có thể đến đích?

Câu trả lời: một component tên là `kube-proxy` chạy trên mọi node và liên tục lập trình một tập hợp các rules iptables. Các rules này sẽ chặn luồng traffic gửi tới một ClusterIP và ghi đè (rewrite) địa chỉ đích của nó — một kỹ thuật gọi là DNAT (Destination NAT) — thành một IP thực của một Pod đang healthy (được chọn ngẫu nhiên). Khi quá trình ghi đè này diễn ra, packet sẽ được xử lý y hệt như bất kỳ packet nào ở Layer 3; ClusterIP đã hoàn thành nhiệm vụ của nó và biến mất khỏi bức tranh.

Hãy tự mình kiểm chứng. Chọn một Service và tìm ClusterIP của nó:

```bash
kubectl get svc  -n 

```

Tìm cái rule đang "bắt" traffic gửi đến nó:

```bash
iptables -t nat -L KUBE-SERVICES -n | grep 

```

Dòng này sẽ trỏ tới một chain dành riêng cho service. Hãy list nó ra:

```bash
iptables -t nat -L KUBE-SVC-XXXXXXX -n

```

Bạn sẽ thấy mỗi dòng tương ứng với một backend Pod đang healthy, mỗi dòng có một `statistic mode random probability` (xác suất ngẫu nhiên). Đây là cách iptables cân bằng tải (load-balance) mà không cần biết trước tổng số lượng backend. Với 5 backend, các xác suất không phải là 0.2 lặp lại 5 lần; chúng là `0.2`, `0.25`, `0.333`, `0.5`, và dòng cuối cùng không có xác suất nào cả.

Mỗi rule chỉ trả lời câu hỏi "tôi có nên nhận packet này không", với điều kiện là tất cả các rule trước đó đã nói "không" — vì vậy bài toán xác suất phải cộng dồn để đảm bảo cơ hội chia đều cho tất cả. Nếu một packet trượt qua 4 rule đầu (điều này xảy ra 80% thời gian), rule thứ 5 không còn phải cạnh tranh với ai nữa — nó cứ thế ôm luôn packet còn lại.

Hãy theo dõi một trong những chain đó đến tận cùng:

```bash
iptables -t nat -L KUBE-SEP-XXXXXXX -n

```

Dòng cuối cùng chính là lệnh ghi đè thực sự:

```text
DNAT  tcp  to:10.244.1.7:3000

```

Xong. ClusterIP chưa từng là một địa chỉ thật — nó chỉ là một rule nói rằng "Bất cứ ai hỏi tìm cái này, hãy đưa cho họ một trong những cái này thay thế", và rule này được áp dụng ngay tại node gửi, trước khi bảng định tuyến ở Layer 3 kịp nhìn thấy packet. Một khi DNAT đã chạy, khâu định tuyến không cần biết hay quan tâm rằng một Service đã từng tồn tại; nó chỉ việc forward packet tới một IP Pod, y như cách nó vẫn làm.

Còn một chi tiết nữa đáng nhắc tới: có một rule đồng hành, `KUBE-MARK-MASQ`, rule này không ghi đè bất cứ thứ gì — nó chỉ gắn tag cho packet. Cái tag đó báo cho một rule xử lý phía sau (nằm trong `POSTROUTING`) biết rằng nó cũng phải ghi đè địa chỉ nguồn (source address) trước khi packet rời khỏi node. Nhờ vậy, câu trả lời (reply) sẽ quay về qua đúng cái node ban đầu và được "dịch ngược" (un-rewritten) một cách chính xác. Nếu không có bước này, câu trả lời từ Pod sẽ bay thẳng về máy gửi ban đầu mang theo IP thật của backend — một địa chỉ mà máy gửi chưa từng yêu cầu — và kết nối sẽ bị gãy.

## Ghép tất cả lại với nhau

Luồng request từ một Pod đến một Service, từ đầu đến cuối:

1. Pod A tạo một packet gửi đến một ClusterIP.
2. Packet đi ra ngoài qua `veth pair` của nó.
3. Node đọc địa chỉ đích, thấy nó khớp với một rule `KUBE-SERVICES`.
4. Kỹ thuật `DNAT` ghi đè địa chỉ đích thành IP thật của một Pod đang healthy, được chọn ngẫu nhiên.
5. **Bây giờ** bảng định tuyến (routing table) mới được tra cứu, với IP Pod thật.
6. Packet được forward thẳng trong cùng một node, hoặc được bàn giao cho node thực sự chứa Pod đó thông qua card mạng thật (NIC).
7. Bảng định tuyến của node đích giao nó đến đúng cổng `veth` tương ứng.
8. Packet đến đích an toàn bên trong network namespace của Pod nhận.

Bốn layer, mỗi layer đều rất đơn giản nếu đứng một mình: một namespace bị cô lập, một đường ống thoát ra ngoài, một bảng tra cứu biết rõ phải forward mọi thứ đi đâu, và một bước ghi đè bổ sung để giúp một địa chỉ ảo ổn định có thể hoạt động trơn tru phía trên các Pod cứ sinh ra rồi lại chết đi. Chẳng có phép màu nào ở đây cả một khi bạn đã tận mắt đọc chúng từ chính cluster của mình thay vì nhìn vào sơ đồ ai đó vẽ.

Nếu bạn muốn đi sâu thêm một layer nữa: Các object `NetworkPolicy` cũng biên dịch (compile) xuống thành các iptables rules tương tự, dùng chung từ vựng — các chains, các rule họ hàng với DNAT dùng để lọc — chỉ là chúng trả lời câu hỏi "packet này có được phép đi qua không" thay vì "packet này sẽ đi về đâu".