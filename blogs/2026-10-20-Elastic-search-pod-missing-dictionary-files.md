---

title: "Pod Elasticsearch bị Readiness Loop do lỗi thiếu file Dictionary khi Helm Upgrade"
date: "2026-10-20"
severity: "P2"
status: "resolved"
duration: "Khoảng 19–20 giờ (từ thời điểm pod dính lỗi 19/10 04:48Z tới khi khôi phục)"
author: "Team Platform / Backend"
tags: ["kubernetes", "eks", "elasticsearch", "helm"]
summary: "Một đợt update Helm Chart làm tái tạo Pod Elasticsearch nhưng bị thiếu mất file cấu hình custom analyzer/dictionary. Lỗi này làm primary shard của index quan trọng không thể mount, khiến cluster chuyển sang trạng thái Red và kéo theo readiness probe thất bại liên tục, làm quá trình rolling update bị nghẽn."

---

## Tổng quan sự cố

Vào ngày 19/10/2026, trong đợt cập nhật Helm Chart cho cụm Elasticsearch (`elasticsearch-master` thuộc namespace `elastic`), Pod `elasticsearch-master-2` sau khi khởi động lại đã rơi vào trạng thái `0/1 Running` (Readiness Probe thất bại).

Nguyên nhân gốc do tiến trình khởi tạo Index `skus_v1` trên node 2 yêu cầu file từ điển tiếng Nhật/custom analyzer (`/usr/share/elasticsearch/config/analyzers/dictionary.txt`) nhưng không tìm thấy file này trên container. Shard primary bị lỗi mount vượt quá 5 lần retry tối đa (`max_retry`), khiến Elasticsearch dừng hẳn việc thử lại và đánh dấu Shard là `UNASSIGNED`. Hệ quả là Cluster rơi vào trạng thái **RED**, Readiness Probe của Pod bị block (do yêu cầu `wait_for_status=green` hoặc `yellow`), chặn đứng tiến trình Rolling Update của StatefulSet.

## Dòng thời gian

| Thời gian (UTC) | Thời gian (ICT) | Sự kiện |
| --- | --- | --- |
| 2026-10-19 04:48 | 11:48 | Thực hiện Helm upgrade / restart Pod. Pod `elasticsearch-master-2` tạo mới nhưng thiếu file `analyzers/dictionary.txt`. |
| 2026-10-19 ~05:00 | ~12:00 | Primary shard của `skus_v1` thử gán vào `elasticsearch-master-2` thất bại 5 lần liên tiếp (`ALLOCATION_FAILED`). Cluster chuyển sang trạng thái **RED**. |
| — | — | Đã bổ sung file từ điển thiếu thông qua ConfigMap, tuy nhiên Elasticsearch Decider không tự động thử lại gán Shard. |
| 2026-10-20 00:00 | 07:00 | Tiến hành kiểm tra thủ công. Phát hiện Pod `elasticsearch-master-2` đã lên được 19 tiếng nhưng vẫn giữ trạng thái `0/1 Running` do Readiness Probe không qua. |
| 2026-10-20 00:20 | 07:20 | Xác nhận trạng thái Cluster Red thông qua API `_cluster/health` và phát hiện nguyên nhân gốc qua `_cluster/allocation/explain`. |
| 2026-10-20 00:30 | 07:30 | Thực hiện lệnh API `_cluster/reroute?retry_failed=true` từ `elasticsearch-master-0`. |
| 2026-10-20 00:32 | 07:32 | Cluster ngay lập tức khôi phục về trạng thái **GREEN**, shard `skus_v1` được mount lại thành công. |
| 2026-10-20 00:35 | 07:35 | Pod `elasticsearch-master-2` chuyển sang `1/1 Ready`. Tiến trình Rolling Update tiếp tục tự động áp dụng cho các node còn lại (`master-1`, `master-0`). |

## Nguyên nhân gốc rễ

1. **Thiếu file phụ thuộc khi tạo Container mới:** Môi trường Pod mới không Mount đủ các file tài nguyên dùng cho Elasticsearch Custom Analyzers (`analyzers/dictionary.txt`, `synonym.txt`, v.v.), dẫn đến lỗi `NoSuchFileException` ngay khi Node cố gắng nạp lại dữ liệu từ Shard cũ.
2. **Cơ chế Retry Limit của Elasticsearch:** Khi một Shard bị lỗi gán (`ALLOCATION_FAILED`) quá 5 lần, Elasticsearch sẽ kích hoạt cơ chế bảo vệ và ngưng tự động retry để tránh lặp lại vòng lặp crash.
3. **Mối liên hệ giữa Readiness Probe và Cluster Health:** Readiness probe của Helm Chart mặc định cấu hình truy vấn Endpoint Health đòi hỏi trạng thái Cluster phải ở ngưỡng an toàn (`green`/`yellow`). Khi Cluster dính lỗi Red do unassigned primary shard trên Pod mới, chính Pod đó bị đánh giá là Unready.
4. **Bẫy StatefulSet Rolling Update:** Do StatefulSet cập nhật Pod theo cơ chế ngược (`master-2` -> `master-1` -> `master-0`) và chỉ tiến hành Pod tiếp theo khi Pod trước đã `1/1 Ready`, sự cố tại `master-2` làm toàn bộ đợt rollout bị treo vô thời hạn.

## Ảnh hưởng

* **Khách hàng / Người dùng:** Trực tiếp không bị gián đoạn nặng do `elasticsearch-master-0` và `elasticsearch-master-1` vẫn hoạt động và giữ các replica/primary khác, tuy nhiên dữ liệu liên quan tới index `skus_v1` bị gián đoạn truy xuất trong thời gian cluster Red.
* **Doanh thu:** Không ghi nhận thiệt hại trực tiếp.
* **SLA / Operations:** Tiến trình Deployment bị block gần 20 tiếng, hệ thống chạy trong trạng thái degraded (mất khả năng dự phòng trên node 2).

## Phát hiện

* Sự cố được phát hiện khi kỹ sư quan sát trạng thái Pod bằng `kubectl get po -n elastic` và thấy `elasticsearch-master-2` giữ trạng thái `0/1 Running` suốt 19 tiếng mà không chuyển sang Ready.
* Truy vết thông qua log internal Elasticsearch và các lệnh query Cluster Health API (`_cluster/health`, `_cat/shards`, `_cluster/allocation/explain`).

## Khắc phục

1. **Khôi phục Shard bị kẹt:** Thực hiện gọi lệnh `reroute` ép Elasticsearch giải phóng cờ max retry và khôi phục các unassigned shards:
```bash
kubectl exec -n elastic elasticsearch-master-0 -c elasticsearch -- \
  sh -c 'curl -sk -u elastic:"$ELASTIC_PASSWORD" -XPOST "https://localhost:9200/_cluster/reroute?retry_failed=true&metric=none"'

```


2. **Xác nhận khôi phục:**
* Kiểm tra Cluster Status bằng `_cluster/health`, xác nhận trạng thái chuyển từ `red` sang `green`.
* Kiểm tra `kubectl get po -n elastic`, Pod `elasticsearch-master-2` vượt qua Readiness Probe và đạt trạng thái `1/1 Ready`.
* Tiến trình StatefulSet tự động tiếp tục đợt Rolling Update cho `elasticsearch-master-1` và `elasticsearch-master-0` an toàn.



## Hạng mục hành động

| Hành động | Phụ trách | Hạn hoàn thành | Trạng thái |
| --- | --- | --- | --- |
| Đảm bảo toàn bộ 6 file từ điển/analyzers được mount đồng bộ via ConfigMap/Volume trong Helm values cho mọi Node | DevOps / Infrastructure | — | ✅ Đã xong |
| Rà soát lại cấu hình `number_of_replicas` trên các index quan trọng (như `skus_v1`) để luôn có ít nhất 1 replica dự phòng | Backend / Search Team | — | ⏳ Đang chờ |
| Cấu hình Alerting gửi thông báo về Slack/PagerDuty ngay khi Cluster Elasticsearch rơi vào trạng thái `RED` hoặc `YELLOW` quá 5 phút | SRE Team | — | ⏳ Đang chờ |
| Bổ sung hướng dẫn xử lý kẹt Shard (`reroute?retry_failed=true`) vào Runbook vận hành Elasticsearch nội bộ | Platform Team | — | ⏳ Đang chờ |

## Bài học rút ra

1. **Thêm file tài nguyên trước khi Rollout:** Các file Analyzer, Dictionary, Synonym cấu hình cho Elasticsearch phải luôn được đảm bảo tồn tại đồng bộ trên Kubernetes ConfigMap/Persistent Volume trước khi tiến hành Restart/Upgrade Pods.
2. **Hiểu rõ hành vi của Elasticsearch Allocation Decider:** Đã khắc phục xong nguyên nhân gốc (đã bổ sung file) không đồng nghĩa với việc Elasticsearch sẽ tự chạy lại. Cần chủ động kiểm tra `_cluster/allocation/explain` để biết khi nào cần dùng lệnh `reroute?retry_failed=true`.
3. **Cảnh giác với cơ chế Rolling Update của StatefulSet:** Một Pod không Ready sẽ chặn đứng toàn bộ pipeline deployment. Đây vừa là cơ chế bảo vệ (giúp 2 pod còn lại không bị dính lỗi tương tự), nhưng cũng dễ tạo ra cảm giác "nghẽn hệ thống" nếu không giám sát kĩ kịch bản Probe thất bại.
4. **Luôn duy trì Replica cho các Index quan trọng:** Việc đặt `number_of_replicas = 0` làm tăng nguy cơ gián đoạn dịch vụ và khiến Cluster lập tức chuyển Red khi chỉ một Node gặp sự cố.