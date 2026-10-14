---
title: "Chiếc đồng hồ đằng sau mọi lệnh kubectl: etcd, Revisions, và tại sao patch thực chất là PUT"
date: "2026-10-14"
category: "Kubernetes"
tags: ["kubernetes", "etcd", "api-server", "watch", "devops"]
author: "Phú Nguyễn"
summary: "Mọi object trong Kubernetes đều là một key trong etcd, và mỗi thay đổi đều làm tăng một bộ đếm duy nhất trên toàn cluster. Việc đọc trực tiếp bộ đếm đó sẽ giải thích resourceVersion, lỗi 'object has been modified', và cách các controller không bao giờ bỏ lỡ một sự kiện nào. Mọi con số ở đây đều đến từ một cluster Kind thực tế."

---

Trong các bài viết trước, tôi đã đi theo một gói tin (packet) và một giới hạn bộ nhớ xuống tận tầng kernel. Bài viết này sẽ đi theo một thứ đơn giản hơn nhiều: file YAML mà bạn gõ `kubectl apply`. Nó thực sự sống ở đâu, và điều gì sẽ xảy ra khi hai tiến trình cùng thay đổi nó một lúc? Câu trả lời nằm ở một bộ đếm duy nhất, và bạn hoàn toàn có thể tự mình đọc nó.

Tất cả các câu lệnh bên dưới đều được chạy trên một cluster Kind single-node. Trên một cluster được quản lý như EKS, bạn không thể tiếp cận etcd (AWS đã giấu kín phần control plane), do đó hãy thực hành trên một cluster lab, đừng làm trên production.

## Mô hình tư duy: Một sổ bạ cho cả tòa nhà

Hãy hình dung cluster như một tòa nhà chung cư với một sổ bạ duy nhất đặt tại quầy lễ tân. Mỗi Pod, Service, hay ConfigMap đều là một dòng trong cuốn sổ đó. Chỉ có quầy lễ tân (API server) mới được quyền ghi vào sổ, và mỗi lần ghi sẽ nhận được một số trang tiếp theo. Cuốn sổ bạ đó chính là etcd, và số trang chính là revision.

## Bước 1: Nhìn vào các keys

Tìm etcd pod và mở một shell command bên trong nó:

```bash
kubectl -n kube-system get pods | grep etcd
ETCD=etcd-<tên-node-của-bạn>

kubectl -n kube-system exec $ETCD -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/pods/kube-system --prefix --keys-only

```

Ý nghĩa từng phần:

* `kubectl exec $ETCD --` chạy câu lệnh đằng sau `--` bên trong etcd pod. Dấu `--` dùng để ngăn cách các cờ (flags) của kubectl với câu lệnh thực thi.
* `etcdctl` là công cụ CLI của chính etcd, đã có sẵn trong image.
* `--endpoints` là địa chỉ của etcd. `127.0.0.1:2379` hoạt động vì chúng ta đang ở bên trong pod; `2379` là port client của etcd.
* `--cacert`, `--cert`, `--key` là các file TLS. etcd sử dụng mutual TLS, nên client cũng phải xuất trình certificate.
* `get <key> --prefix` đọc mọi key bắt đầu bằng đoạn text đó. `--keys-only` chỉ in ra tên key.

Kết quả trả về sẽ là các tên dạng `/registry/pods/kube-system/<tên-pod>`. Toàn bộ schema được lưu theo cấu trúc `/registry/<kind>/<namespace>/<tên>`.

## Bước 2: Giá trị không phải là YAML

Hãy theo dõi sự thay đổi của một ConfigMap theo thời gian thực (lệnh watch sẽ giữ kết nối mở cho đến khi bạn ấn Ctrl+C):

```bash
kubectl -n kube-system exec $ETCD -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  watch /registry/configmaps/default/ --prefix

```

Mở một terminal thứ hai và gõ:

```bash
kubectl create configmap demo --from-literal=a=1
kubectl patch configmap demo -p '{"data":{"a":"2"}}'
kubectl delete configmap demo

```

Terminal đầu tiên sẽ in ra `PUT`, `PUT`, `DELETE`. Có hai điểm đáng chú ý ở đây:

1. **Giá trị trả về là dạng nhị phân (binary):** Nó bắt đầu bằng `k8s` và sau đó là `v1 ConfigMap`. Kubernetes lưu trữ các object dưới dạng Protobuf chứ không phải YAML. Tuy nhiên, bạn vẫn có thể nhìn thấy tên, namespace, UID, cùng các giá trị `a1` rồi `a2` thấp thoáng trong mớ dữ liệu đó.
2. **`patch` hiển thị dưới dạng `PUT`:** etcd chỉ biết đến `PUT` và `DELETE`; nó không có khái niệm "chỉ thay đổi một trường". Khi bạn thực hiện patch, API server sẽ đọc object hiện tại, hợp nhất (merge) thay đổi của bạn trong bộ nhớ RAM, rồi ghi đè lại toàn bộ object đó vào etcd. Vậy nên một thao tác patch thực chất là: **đọc, sửa, ghi đè**.

Thao tác `PUT` thứ hai cũng cho thấy trường `managedFields`: `kubectl-create` và `kubectl-patch` xuất hiện như những "manager" riêng biệt, mỗi bên sở hữu những trường mà nó đã đụng vào. Đây là cách Kubernetes theo dõi ai đã thay đổi thứ gì, và cũng chính là cơ chế đứng sau những trận "xung đột" giữa ArgoCD selfHeal và Operator trong việc giành quyền kiểm soát số lượng replicas.

## Bước 3: Bộ đếm revision

Mỗi lần ghi vào etcd, trên bất kỳ key nào, đều làm tăng một bộ đếm duy nhất trên toàn cluster. Hãy hỏi etcd về key `demo` sau khi vừa tạo nó:

```bash
kubectl create configmap demo --from-literal=a=1
kubectl get configmap demo -o jsonpath='{.metadata.resourceVersion}{"\n"}'
kubectl -n kube-system exec $ETCD -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/configmaps/default/demo --keys-only -w json

```

Đoạn `jsonpath` chỉ in ra giá trị của trường `resourceVersion`. Trong lần chạy của tôi, nó in ra `5907`, và etcd trả về:

```json
"create_revision":5907, "mod_revision":5907, "version":1

```

`resourceVersion` chính là `mod_revision`. Con số xuất hiện trong mọi file YAML bạn từng đọc chính là số trang của lần ghi cuối cùng lên object đó.

Sau một lệnh patch, chính key đó báo về `create_revision` là 5561 (không đổi), `mod_revision` là 5666, và `version` là 2. Ý nghĩa của ba trường này như sau:

| Trường | Ý nghĩa |
| --- | --- |
| `create_revision` | Số trang khi key được sinh ra; không bao giờ thay đổi |
| `mod_revision` | Số trang của lần ghi gần nhất |
| `version` | Số lần key cụ thể này đã được ghi |

Giá trị revision nằm trong phần response header lại là một thứ khác: đó là bộ đếm của toàn bộ cluster tại thời điểm hiện tại. Nó vẫn nhảy liên tục ngay cả khi bạn không làm gì, vì các nhịp heartbeat và lease bầu chọn leader diễn ra liên tục. Giữa lúc tôi thực hiện lệnh create và patch, nó đã nhảy khoảng 100 lượt ghi chỉ trong vài giây tôi gõ phím.

## Tại sao lỗi "object has been modified" lại xuất hiện?

Kubernetes sử dụng cơ chế **Optimistic Concurrency Control** (kiểm soát truy cập đồng thời lạc quan). Không có gì bị khóa (lock) lại cả. Khi bạn thực hiện ghi, bạn gửi kèm giá trị `resourceVersion` mà bạn đọc được gần nhất, và API server chỉ yêu cầu etcd ghi nếu `mod_revision` của key đó vẫn bằng đúng con số đó. Nếu có ai đó đã ghi chen vào giữa, hai con số sẽ khác nhau và bạn nhận về lỗi `Conflict`.

Bạn có thể tự cố tình tạo ra lỗi này:

```bash
kubectl create configmap demo --from-literal=a=1
kubectl get configmap demo -o yaml > /tmp/demo.yaml
kubectl patch configmap demo -p '{"data":{"a":"2"}}'
sed -i 's/a: "1"/a: "3"/' /tmp/demo.yaml
kubectl replace -f /tmp/demo.yaml

```

Dòng 2 lưu lại một snapshot chứa `resourceVersion` cũ. Dòng 3 đóng vai "một ai đó" vừa thay đổi object. Dòng 5 cố ghi đè snapshot đã cũ đó ngược trở lại và bị từ chối thẳng thừng với thông báo: `Operation cannot be fulfilled on configmaps "demo": the object has been modified; please apply your changes to the latest version`.

Một controller khi gặp phải lỗi này sẽ tiến hành đọc lại dữ liệu mới nhất và thử lại (retry) — đó chính xác là những gì một vòng lặp Reconcile làm khi nhận được báo lỗi trả về.

## Tại sao các watch không bao giờ bỏ lỡ sự kiện

`resourceVersion` cũng đóng vai trò như một điểm đánh dấu (bookmark). Một controller khi lấy danh sách (list) các object sẽ ghi nhớ phiên bản $N$ của danh sách đó, sau đó bắt đầu theo dõi (watch) với yêu cầu "lấy tất cả mọi thứ xảy ra sau phiên bản $N$". Không hề có khoảng trống (gap) nào giữa khâu list và watch. Nếu kết nối bị ngắt, nó chỉ việc khôi phục lại từ phiên bản cuối cùng mà nó nhìn thấy.

Bạn có thể tự mình "phát lại lịch sử". Đoạn script này tạo, patch, rồi xóa một ConfigMap trước, sau đó mới bắt đầu watch từ phiên bản đã được ghi lại:

```bash
kubectl create configmap demo --from-literal=a=1
RV=$(kubectl get configmap demo -o jsonpath='{.metadata.resourceVersion}')
kubectl patch configmap demo -p '{"data":{"a":"2"}}'
kubectl delete configmap demo
kubectl -n kube-system exec $ETCD -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  watch /registry/configmaps/default/demo --rev=$RV

```

Lệnh `RV=$(...)` lưu kết quả vào một biến môi trường, và `--rev=$RV` yêu cầu watch bắt đầu đúng từ revision đó. Cả ba sự kiện (`PUT`, `PUT`, `DELETE`) lập tức được in ra màn hình, mặc dù chúng đã diễn ra hoàn toàn trước khi lệnh watch bắt đầu chạy.

## Giới hạn: Lịch sử sẽ bị nén (compacted)

Lịch sử không được lưu giữ vĩnh viễn. Mặc định, `kube-apiserver` sẽ yêu cầu etcd dọn dẹp và nén dữ liệu (compact) mỗi 5 phút một lần để loại bỏ các revision cũ. Tôi đã vô tình đụng phải điều này: tôi chờ khoảng 10 phút rồi mới phát lại từ revision 5907 và nhận được thông báo:

```text
watch was canceled (etcdserver: mvcc: required revision has been compacted)

```

Các controller cũng sẽ nhìn thấy điều tương tự dưới dạng lỗi `too old resource version` trong log của chúng. Cách chúng xử lý là thực hiện lấy lại toàn bộ danh sách (list) một lần nữa và bắt đầu một tiến trình watch mới từ phiên bản của danh sách mới đó.

## Toàn bộ chuỗi xử lý, từ đầu đến cuối

```text
kubectl apply
      ↓
API server: xác thực, phân quyền, kiểm duyệt (admit), hợp nhất thay đổi
      ↓
Ghi vào etcd, CHỈ KHI resourceVersion vẫn bằng mod_revision
      ↓
Bộ đếm Revision tăng lên; key nhận một mod_revision mới
      ↓
Mọi watcher nhận được sự kiện (PUT / DELETE) kèm theo revision đó
      ↓
Controller thức dậy và thực hiện Reconcile

```

Không có gì ở đây là một message queue hay một cơ sở dữ liệu theo cách hiểu thông thường cả. Nó chỉ đơn giản là một nhật ký ghi chép (log) có thứ tự đi kèm với một bộ đếm duy nhất, và mọi cơ chế bảo vệ (phát hiện xung đột, watch không sót sự kiện, lỗi nén dữ liệu) đều tự nhiên sinh ra từ đúng một con số đó.

Dọn dẹp sau khi thực hành xong:

```bash
kubectl delete configmap demo --ignore-not-found
rm -f /tmp/demo.yaml

```