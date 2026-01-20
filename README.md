## Stable · Resilient · Low-Overhead Edition

### （最终稳定版 · 冻结）

---

## 一、设计目标（Design Goals）

* ​**稳定性优先**​：避免异常流量、误判、策略抖动
* ​**可恢复性强**​：任何问题都能通过“改标签 / 改一条规则”快速恢复
* ​**容错性强**​：节点/规则/DNS 缺失时不崩溃
* ​**性能可控**​：适合软路由/家用设备，避免大规则集与高频探测
* ​**可维护性高**​：换机场 ≈ 改节点名，不改脚本逻辑

---

## 二、节点能力模型（核心思想）

> **节点能力靠“标签”，不是靠国家/测速/猜测**

| 标签                        | 含义                 | 用途                 |
| ----------------------------- | ---------------------- | ---------------------- |
| `[emby]`                | Emby 可用节点        | Emby 专用池          |
| `[vidio]`/`[video]` | 流媒体可用节点       | Netflix / YouTube 等 |
| `[google]`              | Google / AI 稳定节点 | Gemini / Google / AI |

* 标签大小写不敏感
* 一个节点可有多个标签
* 标签统一放在节点名末尾（强烈推荐）

---

## 三、策略组结构（Proxy Groups）

### 🌍 Global Out@SS

* 智能组（url-test + fallback）
* 非 CN 节点
* 作为大多数出国流量兜底

---

### 🎬 Video Stream@SS

* ​**节点来源**​：仅 `[vidio] / [video]`
* Netflix / YouTube / 流媒体
* YouTube **明确不属于 Google 组**

---

### ⚡ Emby (Best)@SS

* ​**节点来源**​：仅 `[emby]`
* url-test 池
* 不直接被规则引用，仅作为子池

---

### 📺 Emby-DIRECT@SS

* fallback
* 顺序：`DIRECT → ⚡ Emby (Best)`
* 用于**可直连的 Emby 域名/IP**

---

### 📺 Emby-PROXY@SS

* fallback
* 顺序：`⚡ Emby (Best) → DIRECT`
* 用于**必须走代理的 Emby 域名/IP**

---

### 🤖 AI & Google@SS

* **手动 select（固定）**
* ​**节点来源**​：仅 `[google]`
* 不测速、不自动切
* 如果存在 `[google]` 节点 → **不提供 DIRECT（防手滑）**

**包含：**

* OpenAI / Anthropic / Perplexity / 等 AI
* Google 全家桶（Gemini、Gmail、APIs…）
* **不包含 YouTube**

---

### 🐟 Final Match@SS

* 最终兜底
* `🌍 Global Out → DIRECT`

---

## 四、分流规则逻辑（Rules）

### 1️⃣ Emby（最高优先级）

* 支持域名 + IP
* 规则参数：
  * 默认：直连优先
  * `!` 前缀：强制走代理
  * `=` 前缀：精确域名匹配
  * 组合：`!=emby.example.com`

---

### 2️⃣ AI & Google

* AI 域名 → 🤖 AI & Google
* Google 核心域名 → 🤖 AI & Google
* Gemini / AI Studio 使用 `DOMAIN` 精确匹配（防风暴）

---

### 3️⃣ Video（流媒体）

* Netflix / YouTube
* YouTube 相关域名补齐：
  * `googlevideo.com`
  * `ytimg.com`
  * `youtube-nocookie.com`
  * `youtu.be`

---

### 4️⃣ Telegram / 国内

* Telegram → Global Out
* CN → DIRECT

---

### 5️⃣ MATCH

* → Final Match

---

## 五、DNS 方案（工程级，已集成）

### 核心原则

* ​**IP 形式 default-nameserver**​（防鸡生蛋）
* **CN / 非 CN 分流**
* **DoH 为主，避免 DoT 853**
* **海外 DNS 备援**

### 使用策略

* `use_geosite=1`（默认）
  * 使用 geosite 分流
* `use_geosite=0`
  * 自动退化为 DOMAIN-SUFFIX（最大兼容）

### 不做的事

* ❌ 不做全局广告 DNS 拦截
* ❌ 不做激进 fake-ip-filter
* ❌ 不做复杂 fallback-filter

---

## 六、广告拦截策略（刻意不集成）

* **浏览器端插件（uBlock / AdGuard）** 负责广告
* 路由层不引入大型 RULE-SET
* 原因：
  * 稳定性更高
  * 性能开销更低
  * 排错成本极低

---

## 七、变更记录（Changelog）

### v1.0（最终稳定版 · 冻结）

* ✅ 节点能力完全标签化
* ✅ Google / AI 固定节点策略
* ✅ YouTube 从 Google 组剥离
* ✅ Emby 直连/代理精细控制
* ✅ DNS 工程化整合
* ✅ use\_geosite 开关
* ✅ 性能与稳定性平衡完成
