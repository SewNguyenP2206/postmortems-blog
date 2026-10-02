---

title: "Ai thực sự đã 'giết' Pod của bạn khi nó cạn kiệt bộ nhớ?"
date: "2026-10-02"
category: "Kubernetes"
tags: ["kubernetes", "linux", "cgroups", "devops"]
author: "Phú Nguyễn"
summary: "OOMKilled không phải là do kubelet làm với container của bạn — mà là do kernel (nhân hệ điều hành) thực thi một giới hạn mà bạn đã viết trong file YAML. Cùng xắn tay áo tìm hiểu cgroups, cơ chế nằm dưới mọi trường resources.limits, được kiểm chứng trực tiếp trên một cluster thật."

---

Mọi dòng `resources.limits.memory` mà bạn từng viết trong file YAML cuối cùng đều đi đến một nơi có thật. Không phải nằm trong bộ nhớ của kubelet, cũng chẳng phải trong một hệ thống sổ sách nội bộ nào đó của Kubernetes — mà là trong một file bình thường, nằm trong một thư mục bình thường, nơi bạn có thể tự mình gõ lệnh `cat` để xem. Bài viết này sẽ đi tìm cái file đó và xem cách nó hoạt động.

## Mô hình tư duy: Mỗi căn hộ một công tơ điện

Nếu bạn đã đọc bài viết của tôi về mạng trong Kubernetes, bạn đã nắm được một nửa bức tranh: mỗi Pod sống trong một network namespace (không gian mạng) khép kín của riêng nó. Namespace trả lời cho câu hỏi *"Pod này có thể nhìn thấy gì?"* — còn cgroups trả lời một câu hỏi khác: *"Pod này được phép dùng bao nhiêu, và ai là người chấm điểm (theo dõi)?"*

Hãy tưởng tượng mỗi căn hộ (container) có một công tơ điện riêng, được cài đặt sẵn một mức tiêu thụ tối đa — ví dụ, 50 watt. Cắm điện quá nhiều thiết bị, aptomat (cầu dao) sẽ không đợi người quản lý tòa nhà nhận ra rồi mới chạy đến xử lý. Nó sẽ tự động nhảy (ngắt điện) ngay lập tức, đúng vào khoảnh khắc giới hạn bị vượt qua. Cái công tơ điện đó chính là cgroup. Và OOMKilled chính là sự kiện aptomat bị nhảy.

## Đi tìm file thật đứng sau resources.limits.memory

Cgroup của mỗi container tồn tại dưới dạng một thư mục thực sự nằm trong `/sys/fs/cgroup/`. Để tìm một cgroup cụ thể, hãy lấy PID của container và đọc đường dẫn cgroup của nó thẳng từ `/proc`:

```bash
kubectl get pod  -o jsonpath='{.status.containerStatuses[0].containerID}'
# thao tác trên node:
crictl inspect  | grep -A2 '"pid"'
cat /proc//cgroup

```

Câu lệnh cuối cùng sẽ in ra một thứ trông như thế này:

```text
0::/kubelet.slice/kubelet-kubepods.slice/kubelet-kubepods-besteffort.slice/.../cri-containerd-.scope

```

Đây là một đường dẫn tương đối có thật. Thêm tiền tố `/sys/fs/cgroup` vào trước nó, và bạn đang đứng bên trong thư mục tài nguyên thực sự của container đó:

```bash
CGPATH="/sys/fs/cgroup$(cat /proc//cgroup | cut -d: -f3)"
ls "$CGPATH"

```

Có hai file quan trọng nhất ở đây: `memory.max` và `memory.current`.

### memory.max — giới hạn, tính bằng byte, không trừu tượng hóa

Đây chính xác là con số từ file YAML của bạn, đã được quy đổi sang byte. Nếu một Pod không hề cấu hình `resources.limits.memory`, file này sẽ chỉ hiện chữ `max` — tức là không giới hạn. Đó không phải là lỗi; đó là cách Kubernetes đánh dấu một Pod thuộc lớp QoS (Quality of Service) là `BestEffort`. Bạn có thể thấy điều này trực tiếp ngay trong chính đường dẫn cgroup (`kubepods-besteffort.slice` so với `kubepods-burstable.slice` đối với một Pod có đặt giới hạn).

### memory.current — không bị poll (hỏi vòng), không tính toán khi đọc

Đây là phần mà người ta rất dễ hiểu ngược. `memory.current` không phải là một file log được ai đó ghi vào định kỳ, và việc đọc nó cũng không hề kích hoạt một quá trình tính toán nào cả. Kernel duy trì một bộ đếm liên tục cho mỗi cgroup, và nó cập nhật bộ đếm đó vào đúng khoảnh khắc bộ nhớ được cấp phát hoặc giải phóng — không theo lịch trình, và cũng không đợi ai đó hỏi mới làm.

Mỗi khi code bên trong container gọi một thứ gì đó dẫn đến việc cấp phát một page bộ nhớ vật lý, kernel sẽ lập tức "tính tiền" (charge) page đó vào bộ đếm cgroup của container. Khi bộ nhớ được giải phóng, nó cũng hoàn trả (uncharge) ngay lập tức. Việc đọc file `memory.current` không thực hiện bất kỳ công việc nào ở trên — nó chỉ báo cáo giá trị hiện tại của bộ đếm. Giống như việc bạn liếc nhìn đồng hồ treo tường không làm thời gian trôi đi. Đồng hồ vẫn luôn chạy; bạn chỉ đang nhìn vào nó mà thôi.

Điều này rất đáng để đem ra đối chiếu với cách hoạt động của các công cụ như `top`: chúng liên tục hỏi vòng (poll) file `/proc//status` theo một chu kỳ thời gian nhất định, nghĩa là luôn có một độ trễ nhất định giữa thực tế và những gì bạn nhìn thấy. Bộ đếm cgroup không có độ trễ như vậy — nó được cập nhật inline (ngay tức thì), như một phần của chính luồng code thực thi việc cấp phát bộ nhớ. Đó cũng là lý do tại sao việc đọc nó tốn rất ít chi phí tài nguyên, ngay cả đối với một container đang chạy hàng nghìn tiến trình.

## Tận mắt xem một giới hạn bị "tuýt còi"

Gác lý thuyết sang một bên, đây là cách duy nhất để thực sự tin vào điều này: ép một container vượt quá giới hạn của nó và đọc chính báo cáo của kernel về chuyện gì đã xảy ra.

```yaml
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: oom-test
spec:
  containers:
    - name: eat-memory
      image: polinux/stress
      resources:
        limits:
          memory: "50Mi"
        requests:
          memory: "50Mi"
      command: ["stress"]
      args: ["--vm", "1", "--vm-bytes", "150M", "--vm-hang", "1"]
EOF

```

Một container khai báo giới hạn `50Mi`, nhưng lại cố tình ngốn 150MB. Hãy xem điều gì xảy ra:

```bash
kubectl get pod oom-test -w
oom-test   1/1     Running     0
oom-test   0/1     OOMKilled   0
oom-test   1/1     Running     1 (3s ago)

```

`kubectl` báo cho bạn biết chuyện đó đã xảy ra. Nhưng log của chính kernel mới nói cho bạn biết *ai* đã làm việc đó:

```bash
dmesg -T | grep -i "oom\|killed process"
Memory cgroup out of memory: Killed process 20121 (stress) total-vm:154392kB, anon-rss:50560kB ...

```

Hãy đọc nó theo nghĩa đen: *"Memory cgroup out of memory"*. Không phải kubelet, không phải containerd, cũng không phải Kubernetes theo một ý nghĩa trừu tượng nào đó — mà là kernel, gọi đích danh cái hệ thống con (subsystem) đã ra quyết định, bằng chính lời lẽ của nó. Con số `total-vm:154392kB` khớp gần như hoàn toàn với mức 150MB mà chúng ta đã ra lệnh cho bài test chiếm dụng. Đây chính là kiểu chi tiết đáng để kiểm chứng thay vì chỉ tin tưởng mù quáng — đó cũng là toàn bộ mục đích của việc đọc log thay vì chỉ chấp nhận một chuỗi trạng thái vô hồn.

## Một chi tiết khiến tôi bất ngờ: memory.oom.group

Nếu bạn list các file trong thư mục của cgroup, bạn sẽ tìm thấy một file có tên là `memory.oom.group`. Với các container runtime hiện đại, mặc định file này được bật (`on`) — và nó thay đổi cách thức chọn mục tiêu để "giết" khi vượt quá giới hạn.

Nếu không có nó, kernel sẽ chỉ nhắm mắt chọn ra một tiến trình "tội đồ nhất" duy nhất để giết. Nhưng khi có nó, mọi tiến trình trong cgroup đó sẽ chết chùm cùng nhau, trong cùng một khoảnh khắc:

```text
Tasks in /.../cri-containerd-.scope are going to be killed due to memory.oom.group set
Memory cgroup out of memory: Killed process 20121 (stress) ...
Memory cgroup out of memory: Killed process 20094 (stress) ...

```

Hai PID khác nhau, cùng một timestamp, cùng một sự kiện kill. Lý do đằng sau nó rất dễ hiểu một khi bạn nhận ra: một container thường chạy nhiều hơn một tiến trình, và nếu chỉ giết một cái thì có thể khiến những tiến trình còn lại phải chạy trên một trạng thái đã bị hỏng hóc, chắp vá. Giết cả cụm (group) sẽ đảm bảo rằng lần khởi động lại tiếp theo mọi thứ sẽ bắt đầu sạch sẽ từ đầu.

## Toàn bộ chuỗi sự kiện, từ đầu đến cuối

Bạn viết  `resources.limits.memory: "50Mi"`  vào Pod spec
↓
kubelet tạo container thông qua containerd
↓
containerd ghi giá trị đó vào file `memory.max` cho một cgroup mới
↓
Một tiến trình bên trong container cấp phát (allocate) bộ nhớ
↓
Kernel "tính tiền" (charge) từng khoản cấp phát đó vào `memory.current`, ngay tức thì lúc nó diễn ra
↓
`memory.current` vượt ngưỡng `memory.max`
↓
OOM killer của kernel được kích hoạt — ngay tại đây, không phải trong kubelet
↓
`memory.oom.group` đã được set → mọi tiến trình trong cgroup bị giết cùng nhau
↓
containerd quan sát thấy container đã thoát (mã lỗi 137) và báo cáo lại
↓
kubelet đánh dấu Pod là OOMKilled và khởi động lại nó theo policy

Một câu duy nhất đáng nhớ trong tất cả mớ này: **kubelet không giết bất cứ thứ gì cả.** Nó chỉ là kẻ phát hiện ra sự việc sau khi mọi chuyện đã rồi, và đứng ra viết điếu văn mà thôi. Quyết định thực sự — cái khoảnh khắc mà "quá nhiều bộ nhớ" biến thành "tiến trình này không còn tồn tại nữa" — xảy ra hoàn toàn bên trong kernel, được thực thi bởi một bộ đếm không bao giờ rảnh rỗi ngồi đợi ai đó đến hỏi thăm.

Dọn dẹp sau khi xong việc:

```bash
kubectl delete pod oom-test

```