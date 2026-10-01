---

title: "Search Service (Staging) – Lỗi TLS Elasticsearch do thiếu CA trong Image"
date: "2026-09"
language: vi
translation: "postmortem-ai-product-search-worker-otel-timeout"
severity: "P3"          # non-production
status: "monitoring"    # đã áp dụng bản fix; đang chờ xác nhận
duration: "TBD"
services:

* "Search service (staging)"
* "Elasticsearch (staging)"
author: "Phú Nguyễn"
tags:
* "elasticsearch"
* "tls"
* "certificate"
* "kubernetes"
* "ci-cd"
summary: "Ở môi trường non-production, search service tạch toàn bộ request gọi đến Elasticsearch với lỗi 'unable to verify the first certificate' vì container image bị thiếu mất CA của cluster Elasticsearch tương ứng."

---

## Tổng quan sự cố

Ở một môi trường non-production, một search service viết bằng Node.js bắt đầu văng lỗi khi gọi đến Elasticsearch với thông báo:

`ConnectionError: unable to verify the first certificate`

Một môi trường non-prod khác, được deploy từ cùng một chart với config gần như y hệt, lại chạy mượt mà. Không có hệ thống production nào bị ảnh hưởng.
Pha cứu nét đầu tiên là mount CA của cluster vào pod và set biến `NODE_EXTRA_CA_CERTS`, nhưng không có tác dụng, lý do là bản thân ứng dụng đã tự truyền CA riêng của nó vào client Elasticsearch.

## Dòng thời gian

| Thời gian (UTC) | Sự kiện |
| --- | --- |
| T+0 | Service văng log `unable to verify the first certificate` khi thực hiện request gọi Elasticsearch |
| T+~1h | Deploy lại pod, mount CA của cluster dưới dạng file và set biến `NODE_EXTRA_CA_CERTS` |
| T+~1h | Lỗi vẫn y nguyên, không trượt phát nào |
| Sau đó | Test trực tiếp trong pod (in-pod test) cho thấy kết nối TLS đến Elasticsearch thành công, kể cả khi truyền CA thủ công hay chỉ dùng `NODE_EXTRA_CA_CERTS`, chứng tỏ bản thân file CA là chuẩn |
| Sau đó | Soi lại code thì lòi ra ứng dụng khởi tạo Elasticsearch client với một CA được chỉ định cứng từ một đường dẫn config, qua mặt luôn `NODE_EXTRA_CA_CERTS` |
| Sau đó | Đem CI pipeline của hai môi trường ra so thì thấy một bên có lệnh copy file CA vào image lúc build, bên kia thì không |
| Sau đó | Chỉnh config đường dẫn CA trỏ vào file CA vừa được mount |
| TBD | Lỗi biến mất và xác nhận service đã hồi sinh |

*Lưu ý: Thời gian tương đối (T+) được sử dụng vì timestamp chính xác không quá quan trọng đối với các bài học rút ra.*

## Nguyên nhân gốc rễ

Ứng dụng tự khởi tạo Elasticsearch client với CA riêng của nó:

```javascript
tls: {
  ca: fs.readFileSync(CA_PATH),
  rejectUnauthorized: true,
}

```

Khi một client được truyền tham số `tls.ca` riêng, Node sẽ chỉ dùng đúng CA đó cho kết nối này, nên nó bơ luôn biến `NODE_EXTRA_CA_CERTS`.
File CA được đưa vào ở bước build image qua CI, và cái bước đó chỉ tồn tại ở pipeline của một môi trường duy nhất:

```bash
# Pipeline môi trường A
# copy file CA của môi trường này vào build context trước khi chạy docker build

# Pipeline môi trường B
# (không hề có bước này)

```

Mỗi môi trường có một cluster Elasticsearch riêng với CA tự sinh, nên cái CA được "nướng" (bake) cứng vào image của môi trường này không thể nào verify được cluster của môi trường khác. Môi trường có bước copy CA thì chạy ngon; môi trường còn lại thì oẳng.

Các yếu tố góp phần:

* Dòng log lỗi chả chỉ ra file CA nào đang được dùng hay nó chui từ đâu ra.
* Deployment chart chưa hỗ trợ truyền biến môi trường (env vars) hay volumes, nên không có cách nào inject CA từ cluster vào.

## Ảnh hưởng

* **Người dùng bị ảnh hưởng:** chỉ ở môi trường non-production; các request đi qua search service để query Elasticsearch đều tạch.
* **Ảnh hưởng doanh thu:** Không.
* **Tình trạng SLA:** N/A.

## Phát hiện

* **Thời gian phát hiện trung bình (MTTD):** TBD
* **Thời gian xử lý trung bình (MTTR):** TBD
* **Dấu hiệu nhận biết:** Lỗi `ConnectionError` TLS hiển thị trong log ứng dụng.

## Khắc phục

1. Loại trừ mấy cái cảnh báo linh tinh của Elasticsearch và vụ hết hạn chứng chỉ (nếu chứng chỉ hết hạn sẽ báo `certificate has expired`, chứ không ra lỗi này).
2. Mở rộng deployment chart để hỗ trợ thêm các env vars và volumes, rồi mount đúng file CA certificate (không lấy server private key) từ secret của cluster.
3. Verify trực tiếp trong pod xem TLS nối đến Elasticsearch qua cái CA đó có thông chưa.
4. Phát hiện ra app đọc CA từ một đường dẫn config được, và sự khác biệt giữa hai môi trường nằm ở chỗ file CA có bị bake vào image hay không.
5. Trỏ đường dẫn CA trong config vào cái file CA vừa được mount. Sửa tay trực tiếp trên cluster trước, sau đó commit vào chart values để lần deploy sau không đè mất.

## Hạng mục hành động

| Hành động | Phụ trách | Hạn hoàn thành | Trạng thái |
| --- | --- | --- | --- |
| Commit các thay đổi của chart template và values để bản fix sống sót qua lần deploy tiếp theo | TBD | TBD | ⏳ Đang chờ |
| Xác nhận lỗi đã hết hẳn và ghi nhận thời gian khôi phục | TBD | TBD | ⏳ Đang chờ |
| Đồng bộ cách xử lý này cho môi trường còn lại và dẹp ngay trò nướng (bake) file CA vào image | TBD | TBD | ⏳ Đang chờ |
| Cài monitor theo dõi hạn sử dụng của các chứng chỉ Elasticsearch tự sinh | TBD | TBD | ⏳ Đang chờ |
| Bổ sung logic verify kết nối Elasticsearch vào health check để nếu lỗi TLS là lộ ra ngay lúc deploy | TBD | TBD | ⏳ Đang chờ |

## Bài học rút ra

1. Việc "nướng" (bake) file CA vào container image sẽ trói chết image đó với một môi trường duy nhất, và sẽ lỗi ngầm khi chứng chỉ được tự động tạo lại. Mount CA từ cluster secret giúp giữ mọi thứ luôn đồng bộ.
2. `NODE_EXTRA_CA_CERTS` bị vô hiệu hóa với các client tự override `tls.ca`. Hãy check xem client được khởi tạo thế nào trước khi vội lôi biến môi trường ra xài.
3. Khi hai môi trường dùng chung một chart mà chạy ra hai kết quả khác nhau, hãy đem pipeline và image được build ra so sánh, chứ đừng chỉ dán mắt vào mỗi chart values.
4. Trò test trực tiếp trong pod (in-pod test) với trường hợp có và không có CA giúp phân định cực nhanh giữa "CA sai" và "app đếch thèm dùng CA".
5. Sửa tay (manual changes) trực tiếp trên cluster thì trước sau gì cũng bị lần chart deploy tiếp theo đè bẹp, nên mọi bản fix đều phải hạ cánh an toàn vào file chart và values.