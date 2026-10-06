---

title: "Toàn bộ chuyến đi: Điều gì xảy ra giữa lệnh curl và Response, xuyên qua hai Node"
date: "2026-10-06"
category: "Kubernetes"
tags: ["kubernetes", "networking", "conntrack", "iptables", "devops"]
author: "Phú Nguyễn"
summary: "Mọi mảnh ghép từ ba bài viết trước — namespaces, routing, DNS, DNAT — được lắp ráp lại thành một request hoàn chỉnh, từ đầu đến cuối, đi qua hai Node khác nhau. Bổ sung thêm cơ chế quan trọng giúp câu trả lời tự tìm đường quay về mà không ai phải bận tâm suy nghĩ."

---

 Bài viết này ra đời để dừng việc coi chúng là những phần rời rạc. Dưới đây là hành trình của một request, từ một Pod ở Node 1 đến một Pod ở Node 2, không bỏ sót bất kỳ chi tiết nào — bao gồm cả một cơ chế quan trọng mà tôi từng bỏ ngỏ: làm thế nào mà response (câu trả lời) có thể tự tìm đường quay trở lại.

## Thiết lập ban đầu

Pod A nằm trên Node 1, chạy lệnh `curl http://web-svc`. Service `web-svc` có đúng một backend duy nhất: Pod B, nằm trên Node 2. Không có gì phức tạp ở đây cả — đây là trường hợp hết sức bình thường, và chính những thứ bình thường mới là nơi ẩn giấu những cơ chế ngầm thú vị nhất.

## Pha 0 — Biến một cái tên thành địa chỉ IP, trước khi gói tin thực sự tồn tại

File `/etc/resolv.conf` của Pod A đã được trỏ sẵn tới CoreDNS — `kubelet` tự động ghi thông tin này vào, không cần bất kỳ cấu hình thủ công nào. Vì `web-svc` không có dấu chấm nào và tham số `ndots:5` đang có hiệu lực, trình giải mã (resolver) sẽ thử `web-svc..svc.cluster.local` trước tiên, và cái tên này khớp. Bản thân truy vấn DNS đó là một gói tin thực sự, cũng phải đi qua `veth pair` và bảng định tuyến y hệt như mọi gói tin khác — nó không hề được ngoại lệ khỏi bất kỳ máy móc nào bên dưới, chỉ là nó mang theo một câu hỏi thay vì một HTTP request. CoreDNS không tra cứu bất kỳ thứ gì trong bộ nhớ cục bộ; nó hỏi trực tiếp API server và trả về một ClusterIP, ví dụ: `10.96.218.98`.

Đó là kết thúc của Pha 0. Mọi thứ từ đây trở đi là dành cho gói tin TCP thực sự mang theo HTTP request — không còn là câu chuyện của DNS nữa.

## Pha 1 — Rời khỏi Pod A

Ứng dụng đóng gói một packet: nguồn (source) là IP thật của Pod A, đích đến (destination) là `10.96.218.98` — một số điện thoại, chứ không phải một căn hộ, như đã nói trong bài viết về DNS. Gói tin rời khỏi network namespace của Pod A thông qua một đầu của `veth pair` và ngay lập tức xuất hiện ở đầu kia, nằm trong namespace của chính Node 1.

## Pha 2 — Node 1 dịch số điện thoại thành một địa chỉ thực sự

Đây là lúc cấu trúc 3-chain (3 chuỗi) mà tôi đã phân tích trong bài viết về DNAT thực sự làm nhiệm vụ của nó, theo đúng thứ tự:

1. **`PREROUTING`** bắt lấy mọi gói tin đi vào node và giao nó cho các chain riêng của `kube-proxy`.
2. **`KUBE-SERVICES`** so khớp địa chỉ đích với `10.96.218.98`, nhận diện đây là `web-svc`, và nhảy sang chain riêng của Service đó.
3. **`KUBE-SVC-xxxxxx`** tung xí ngầu ngẫu nhiên qua danh sách các backend đang có (trong trường hợp này là 1) và nhảy sang chain của backend đó.
4. **`KUBE-SEP-yyyyyy`** thực hiện hành động ghi đè thực sự — **DNAT** — xé bỏ địa chỉ `10.96.218.98` và thay vào đó bằng IP thật của Pod B: `10.244.1.7`.

Từ khoảnh khắc này, gói tin không còn để lại bất kỳ dấu vết nào của ClusterIP. Nhưng còn một thứ nữa cũng xảy ra ngay tại đây, và nó chính là mảnh ghép giúp phần còn lại của câu chuyện hoạt động trơn tru: kernel ghi lại bản dịch này vào một bảng gọi là **conntrack** (connection tracking) — *"kết nối cụ thể này vừa được ghi đè địa chỉ đích từ X thành Y"*. Chưa có gì dùng đến bản ghi đó vào lúc này. Nó nằm đó để phục vụ cho bước sau.

## Pha 3 — Node 1 quyết định gửi gói tin đi đâu

Với địa chỉ đích thực sự trong tay, Node 1 tra cứu bảng định tuyến (routing table) của nó — vẫn là cơ chế so khớp tiền tố dài nhất (longest-prefix-match) đã nói ở bài viết đầu tiên. IP `10.244.1.7` không khớp với bất kỳ host route `/32` nào của chính Node 1, vì vậy nó rơi vào network route `/24 via `. Gói tin đi ra ngoài qua card mạng thật (NIC) của Node 1.

## Pha 4 — Băng qua giữa các Node

Không có ma thuật nào ở đây trên một mạng phẳng (flat network) như của Kind — gói tin chỉ đơn giản đi qua mạng L2 chung (hoặc trong cùng VPC subnet trên các hạ tầng cloud thực tế) để đến địa chỉ thật của Node 2. Đây là pha duy nhất mà "Kubernetes" không thực sự can thiệp vào; nó chỉ là hai cỗ máy trên cùng một mạng đang giao tiếp với nhau.

## Pha 5 — Node 2 chuyển giao gói tin, hoàn toàn không biết đến sự tồn tại của Service

Node 2 nhận gói tin và kiểm tra bảng định tuyến của chính nó. IP `10.244.1.7` khớp với một host route `/32` cục bộ — Pod này nằm ngay tại đây. Gói tin đi vào cổng `veth` tương ứng và cập bến an toàn bên trong network namespace của Pod B.

Điều này rất đáng để dừng lại suy ngẫm một chút: **Node 2 hoàn toàn không biết một Service đã từng tham gia vào quá trình này.** Nó không bao giờ đụng đến `KUBE-SERVICES`, không bao giờ thực hiện DNAT, và chưa từng nhìn thấy ClusterIP. Đối với Node 2, đây chỉ là một gói tin bình thường được gửi đến một trong các Pod của chính nó. Toàn bộ quá trình dịch chuyển liên quan đến Service đã diễn ra đúng một lần, hoàn toàn nằm trên Node 1.

## Pha 6 — Response quay về, và phần tôi đã bỏ qua cho đến bây giờ

Pod B trả lời (reply). Gói tin của nó có source là `10.244.1.7` (IP thật của nó — nó chưa từng biết đến sự tồn tại của địa chỉ nào khác) và destination là IP thật của Pod A. Gói tin response này đi ngược lại đúng con đường cũ: qua `veth` của Pod B, bảng định tuyến của Node 2, băng qua mạng vật lý, và đi vào Node 1.

Khi quay trở lại Node 1, gói tin response này đụng phải `PREROUTING` một lần nữa — và đây là lúc **conntrack** không còn là một bản ghi nằm im lìm mà bắt đầu làm đúng duy nhất một việc của nó. Kernel tra cứu kết nối này trong bảng conntrack, tìm thấy bản ghi từ Pha 2, và **tự động đảo ngược bản dịch**: địa chỉ source của response được ghi đè từ `10.244.1.7` quay trở lại thành `10.96.218.98`, mà không cần bất kỳ rule mới nào được viết ra cho chiều ngược lại. Gói tin cập bến Pod A trông hoàn toàn giống như một câu trả lời đến từ đúng số điện thoại mà nó đã bấm gọi ban đầu.

Pod A không bao giờ biết Pod B có tồn tại hay không, nó nằm ở node nào, hay request đã đi qua bao nhiêu hop. Nó đặt câu hỏi cho `10.96.218.98` và nhận được câu trả lời từ `10.96.218.98`. Ảo tưởng đó chính là mục đích tồn tại của một Service, và conntrack chính là mảnh ghép giúp ảo tưởng đó sống sót qua cả chuyến đi lẫn chuyến về.

## Toàn bộ bức tranh, dưới dạng một sơ đồ

```text
Pod A (app)
  │ gửi tới ClusterIP (DNS đã phân giải xong)
  ▼
veth → Node 1 namespace
  ▼
PREROUTING → KUBE-SERVICES → KUBE-SVC-xxx → KUBE-SEP-yyy
  │ DNAT: ClusterIP → IP thật của Pod B
  │ conntrack: ghi nhớ bản dịch này
  ▼
Bảng định tuyến Node 1: IP Pod B nằm trong dải /24 của Node 2
  ▼
NIC thật → (đường truyền mạng) → NIC thật trên Node 2
  ▼
Bảng định tuyến Node 2: khớp với /32 cục bộ — chuyển giao trực tiếp
  ▼
veth → Pod B namespace
  ▼
Pod B trả lời (source = IP thật của chính nó)
  ▼
[đường quay về ngược lại qua Node 2, qua mạng vật lý, tới Node 1]
  ▼
Node 1 PREROUTING → conntrack nhận diện ra kết nối này
  │ tự động đảo ngược việc ghi đè: IP thật → ClusterIP
  ▼
veth → Pod A namespace, response cập bến "từ" ClusterIP

```

## Tại sao điều này lại quan trọng hơn bất kỳ mảnh ghép đơn lẻ nào

Mỗi pha riêng biệt ở đây — một `veth pair`, một lần tra cứu bảng định tuyến, một rule `DNAT`, một bản ghi `conntrack` — đều là thứ mà một thành phần đơn lẻ thực hiện mà không cần biết đến những thành phần khác. `kube-proxy` viết các rule DNAT mà không cần biết bảng định tuyến sẽ làm gì với kết quả đó. Bảng định tuyến của kernel không hề biết một Service đã từng tham gia vào cuộc chơi. Node 2 cũng chẳng bao giờ bận tâm tìm hiểu. Conntrack là mảnh ghép duy nhất trải dài qua toàn bộ kết nối, nhưng ngay cả nó cũng không "hiểu" cái gì cả — nó chỉ là một bảng tra cứu khớp câu trả lời quay về với một rule đã từng chạy trước đó.

Một Service tạo cảm giác như một hệ thống đồng nhất, hoàn chỉnh khi nhìn từ bên trong Pod. Nhưng thực ra không phải. Nó là tập hợp của 5 hoặc 6 cơ chế hoàn toàn "mù tịt" về nhau nhưng lại vô tình bàn giao công việc cho nhau một cách chuẩn xác, mỗi một lần, bởi vì mỗi thành phần chỉ làm đúng một việc nhỏ, cụ thể và không gì hơn. Đó mới là bài học thực sự đằng sau cả 4 bài viết trong series này — không phải là bất kỳ câu lệnh riêng lẻ nào, mà là thói quen không bao giờ coi bất cứ thứ gì là một "hệ thống đơn khối" cho đến khi bạn tự mình truy vết và thấu hiểu từng ngóc ngách của nó.

## Tận mắt quan sát conntrack bằng chính mắt bạn

```bash
conntrack -L | grep 

```

Bạn sẽ thấy một bản ghi hiển thị cả hai chiều của bản dịch — chiều gốc (ClusterIP → IP thật của Pod B) và chiều phản hồi (IP thật của Pod B → ClusterIP). Đó chính là "bộ nhớ" giúp chuyến quay về tự đảo ngược chính nó mà không cần bất kỳ rule thứ hai nào phải viết ra cho nó.