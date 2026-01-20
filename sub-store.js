/**
 * Sub-Store / Mihomo(Clash Meta) for OpenClash
 * Stable/Resilient/Low-overhead Edition + DNS integrated
 *
 * Default:
 * - use_geosite=1 (default) : use GEOSITE rules when available
 *   - set use_geosite=0 to fall back to DOMAIN-SUFFIX rules (max compatibility)
 *
 * Nodes by tags:
 * - Emby nodes:   [emby]
 * - Video nodes:  [vidio] OR [video]
 * - AI&Google fixed nodes: [google] (manual select, NO url-test/fallback)
 *   - If [google] nodes exist: DO NOT include DIRECT (anti-misclick)
 *
 * Routing:
 * - Google family bucket EXCLUDES YouTube (YouTube stays in Video)
 * - YouTube related domains补齐到 Video，避免分流不一致
 *
 * DNS (integrated):
 * - default-nameserver: IP only
 * - nameserver: CN DoH + overseas DoH (dual stack fallback)
 * - proxy-server-nameserver: include overseas DoH as backup
 * - nameserver-policy: private/cn/geolocation-!cn split
 *
 * Emby rules:
 * - emby_domains / emby_ipcidr entries:
 *   - default: can direct -> Emby-DIRECT (DIRECT first)
 *   - prefix "!" : cannot direct -> Emby-PROXY (proxy first)
 * - Optional exact domain syntax:
 *   - prefix "=" : exact domain match (DOMAIN)
 *   - otherwise : DOMAIN-SUFFIX
 *   - You can combine: "!=emby.example.com"
 */

function main(config) {
  const args = (typeof $arguments === "object" && $arguments) ? $arguments : {};

  const splitList = (s) =>
    String(s || "")
      .split(/[,\n\r;|]+/g)
      .map(x => x.trim())
      .filter(Boolean);

  const uniq = (arr) => {
    const seen = new Set();
    const out = [];
    for (const x of arr || []) {
      if (!seen.has(x)) { seen.add(x); out.push(x); }
    }
    return out;
  };

  const ns = String(args.ns || "SS").trim();

  const normalizeHost = (s) => {
    s = String(s || "").trim();
    s = s.replace(/^[a-zA-Z]+:\/\//, "");
    s = s.split(/[/?#]/)[0];
    s = s.replace(/:\d+$/, "");
    return s.trim();
  };

  const isIPv4OrCidr = (h) =>
    /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/.test(String(h));

  const hasTag = (tag) => new RegExp(`\\[${tag}\\]`, "i");

  // ---------- 0) Feature flags ----------
  const useGeosite = String(args.use_geosite ?? "1").trim() !== "0"; // default 1

  // DNS behavior flags (optional)
  const dnsEnable = String(args.dns_enable ?? "1").trim() !== "0"; // default 1
  const dnsEnhancedMode = String(args.dns_mode || "fake-ip").trim(); // fake-ip / redir-host
  const dnsIpv6 = String(args.dns_ipv6 ?? "0").trim() === "1"; // default false

  // ---------- 1) Proxy Cleaning ----------
  const proxies = (Array.isArray(config?.proxies) ? config.proxies : []).filter(
    p => p && typeof p.name === "string" && p.name.trim() &&
         !/过期|剩余流量|官网|重置|套餐|到期/i.test(p.name)
  );
  const allProxyNames = proxies.map(p => p.name).filter(Boolean);
  if (allProxyNames.length === 0) return config;

  // ---------- 2) Node Tag Filters ----------
  const embyNodes = uniq(proxies.filter(p => hasTag("emby").test(p.name)).map(p => p.name));
  const videoNodes = uniq(proxies.filter(p => (hasTag("vidio").test(p.name) || hasTag("video").test(p.name))).map(p => p.name));
  const googleNodes = uniq(proxies.filter(p => hasTag("google").test(p.name)).map(p => p.name));

  const globalNodes = uniq(allProxyNames.filter(
    n => !/(?:\bCN\b|China|Mainland|内网|直连|大陆|中国)/i.test(String(n))
  ));

  const chooseNodes = (nodes) => {
    if (Array.isArray(nodes) && nodes.length) return nodes;
    if (globalNodes.length) return globalNodes;
    return allProxyNames;
  };

  const ensureNonEmpty = (nodes, fallback = ["DIRECT"]) => {
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
    return list.length ? list : fallback;
  };

  // ---------- 3) Parameters (probe) ----------
  const healthUrl = String(args.health_url || "https://www.gstatic.com/generate_204").trim();

  // lower overhead defaults; still overridable
  const intervalBest = Number(args.interval_best || 900);
  const intervalFallback = Number(args.interval_fallback || 600);

  // Emby groups
  const embyDirectGroupName = String(args.emby_group_direct || `📺 Emby-DIRECT@${ns}`).trim();
  const embyProxyGroupName  = String(args.emby_group_proxy  || `📺 Emby-PROXY@${ns}`).trim();
  const embyInterval        = Number(args.emby_interval || 300);

  // Emby best pool
  const embyBestName = `⚡ Emby (Best)@${ns}`;
  const embyPool     = ensureNonEmpty(chooseNodes(embyNodes), ["DIRECT"]);

  // ---------- 4) Emby rule parsing ----------
  const rawDomains = splitList(args.emby_domains);
  const rawIps     = splitList(args.emby_ipcidr);

  const parseEmbyDomainEntry = (s) => {
    let t = String(s || "").trim();
    if (!t) return null;

    let forceProxy = false;
    let exact = false;

    for (let i = 0; i < 3; i++) {
      if (t.startsWith("!")) { forceProxy = true; t = t.slice(1).trim(); continue; }
      if (t.startsWith("=")) { exact = true; t = t.slice(1).trim(); continue; }
      break;
    }

    const host = normalizeHost(t);
    if (!host) return null;
    if (isIPv4OrCidr(host)) return null;

    return { host, forceProxy, exact };
  };

  const parseEmbyIpEntry = (s) => {
    let t = String(s || "").trim();
    if (!t) return null;

    let forceProxy = false;
    for (let i = 0; i < 2; i++) {
      if (t.startsWith("!")) { forceProxy = true; t = t.slice(1).trim(); continue; }
      break;
    }

    const host = normalizeHost(t);
    if (!host) return null;
    if (!isIPv4OrCidr(host)) return null;

    return { host, forceProxy };
  };

  const domainEntries = uniq(rawDomains).map(parseEmbyDomainEntry).filter(Boolean);
  const ipEntries     = uniq(rawIps).map(parseEmbyIpEntry).filter(Boolean);

  const embyDomainsDirect = domainEntries.filter(x => !x.forceProxy);
  const embyDomainsProxy  = domainEntries.filter(x =>  x.forceProxy);
  const embyIpsDirect     = ipEntries.filter(x => !x.forceProxy).map(x => x.host);
  const embyIpsProxy      = ipEntries.filter(x =>  x.forceProxy).map(x => x.host);

  // ---------- 5) Smart Group Factory ----------
  const createSmartGroup = (name, nodes) => {
    const list = ensureNonEmpty(chooseNodes(nodes), ["DIRECT"]);
    const best = `⚡ ${name} (Best)@${ns}`;
    const fb   = `🛡️ ${name} (Fallback)@${ns}`;
    const sel  = `${name}@${ns}`;
    return [
      { name: best, type: "url-test", proxies: list, url: healthUrl, interval: intervalBest, lazy: true },
      { name: fb,   type: "fallback", proxies: list, url: healthUrl, interval: intervalFallback },
      { name: sel,  type: "select", proxies: [fb, best, "DIRECT"] }
    ];
  };

  // ---------- 6) AI & Google fixed (by [google]) ----------
  const aiGoogleName = `🤖 AI & Google@${ns}`;
  const aiGoogleProxies = googleNodes.length
    ? [...googleNodes] // no DIRECT
    : [...ensureNonEmpty([globalNodes[0], allProxyNames[0]].filter(Boolean), ["DIRECT"]), "DIRECT"];

  // ---------- 7) Merge upstream rules ----------
  const baseRules = Array.isArray(config?.rules) ? config.rules : [];
  const upstreamRules = baseRules.filter(r => !/^MATCH,/i.test(String(r)));

  // ---------- 8) Names ----------
  const globalOutName = `🌍 Global Out@${ns}`;
  const videoName     = `🎬 Video Stream@${ns}`;
  const finalName     = `🐟 Final Match@${ns}`;

  // ---------- 9) Rule helpers ----------
  const geositeOrDomain = (geositeName, domains, target) => {
    if (useGeosite) return [`GEOSITE,${geositeName},${target}`];
    return (domains || []).map(d => `DOMAIN-SUFFIX,${d},${target}`);
  };

  // Video domain fallbacks
  const VIDEO_NETFLIX_DOMAINS = ["netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com", "nflxso.net"];
  const VIDEO_YOUTUBE_DOMAINS = [
    "youtube.com", "youtu.be", "ytimg.com", "youtube-nocookie.com",
    "googlevideo.com"
  ];

  // ---------- 10) Build rules ----------
  const rules = [];

  // Emby rules
  for (const x of embyDomainsDirect) {
    rules.push(`${x.exact ? "DOMAIN" : "DOMAIN-SUFFIX"},${x.host},${embyDirectGroupName}`);
  }
  for (const x of embyDomainsProxy) {
    rules.push(`${x.exact ? "DOMAIN" : "DOMAIN-SUFFIX"},${x.host},${embyProxyGroupName}`);
  }
  for (const c of embyIpsDirect) {
    rules.push(`IP-CIDR,${c.includes("/") ? c : c + "/32"},${embyDirectGroupName},no-resolve`);
  }
  for (const c of embyIpsProxy) {
    rules.push(`IP-CIDR,${c.includes("/") ? c : c + "/32"},${embyProxyGroupName},no-resolve`);
  }

  // AI services -> fixed
  rules.push(
    `DOMAIN-SUFFIX,openai.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,chatgpt.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,oaistatic.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,oaiusercontent.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,anthropic.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,perplexity.ai,${aiGoogleName}`,
    `DOMAIN-SUFFIX,huggingface.co,${aiGoogleName}`,
    `DOMAIN-SUFFIX,elevenlabs.io,${aiGoogleName}`,
    `DOMAIN-SUFFIX,groq.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,cerebras.ai,${aiGoogleName}`,
    `DOMAIN-SUFFIX,cursor.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,deepseek.com,${aiGoogleName}`
  );

  // Google family bucket (EXCLUDES YouTube) -> fixed
  rules.push(
    `DOMAIN,gemini.google.com,${aiGoogleName}`,
    `DOMAIN,aistudio.google.com,${aiGoogleName}`,
    `DOMAIN,accounts.google.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,clients4.google.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,clients2.google.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,google.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,gmail.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,googleapis.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,googleusercontent.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,gstatic.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,ggpht.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,1e100.net,${aiGoogleName}`,
    `DOMAIN-SUFFIX,gvt1.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,gvt2.com,${aiGoogleName}`,
    `DOMAIN-SUFFIX,gvt3.com,${aiGoogleName}`
  );

  // Video (YouTube stays here)
  rules.push(...geositeOrDomain("netflix", VIDEO_NETFLIX_DOMAINS, videoName));
  rules.push(...geositeOrDomain("youtube", VIDEO_YOUTUBE_DOMAINS, videoName));

  // Telegram / CN
  if (useGeosite) {
    rules.push(`GEOSITE,telegram,${globalOutName}`);
    rules.push(`GEOSITE,cn,DIRECT`);
  } else {
    rules.push(
      `DOMAIN-SUFFIX,telegram.org,${globalOutName}`,
      `DOMAIN-SUFFIX,t.me,${globalOutName}`,
      `DOMAIN-SUFFIX,tdesktop.com,${globalOutName}`
    );
  }
  rules.push("GEOIP,cn,DIRECT,no-resolve");

  // Upstream rules
  rules.push(...upstreamRules);

  // Final
  rules.push(`MATCH,${finalName}`);

  // ---------- 11) DNS integrated ----------
  const dnsBlock = {
    ...(typeof config?.dns === "object" && config.dns ? config.dns : {}),
    enable: dnsEnable,
    ipv6: dnsIpv6,
    "enhanced-mode": dnsEnhancedMode,
    "default-nameserver": [
      "223.5.5.5",
      "119.29.29.29"
    ],
    // CN + Overseas DoH, improves resilience when policy misses
    nameserver: [
      "https://223.5.5.5/dns-query",
      "https://1.12.12.12/dns-query",
      "https://1.1.1.1/dns-query",
      "https://8.8.8.8/dns-query"
    ],
    // Resolve proxy node server domains safely (avoid chicken-egg)
    "proxy-server-nameserver": [
      "https://223.5.5.5/dns-query",
      "https://1.12.12.12/dns-query",
      "https://1.1.1.1/dns-query"
    ],
    "nameserver-policy": {
      ...(config?.dns?.["nameserver-policy"] || {}),
      "geosite:private": [
        "system" // if recursion occurs, replace with your LAN DNS IP (e.g. 192.168.1.1)
      ],
      "geosite:cn": [
        "https://223.5.5.5/dns-query",
        "https://1.12.12.12/dns-query"
      ],
      "geosite:geolocation-!cn": [
        "https://1.1.1.1/dns-query",
        "https://8.8.8.8/dns-query"
      ]
    }
  };

  // ---------- 12) Assemble ----------
  return {
    ...config,
    proxies,
    "log-level": config?.["log-level"] ?? "error",
    dns: dnsBlock,
    "proxy-groups": [
      ...createSmartGroup("🌍 Global Out", globalNodes),
      ...createSmartGroup("🎬 Video Stream", videoNodes),

      // Emby best pool
      {
        name: embyBestName,
        type: "url-test",
        proxies: embyPool,
        url: healthUrl,
        interval: intervalBest,
        lazy: true
      },

      // Emby DIRECT first
      {
        name: embyDirectGroupName,
        type: "fallback",
        proxies: ["DIRECT", embyBestName],
        url: healthUrl,
        interval: embyInterval
      },

      // Emby PROXY first
      {
        name: embyProxyGroupName,
        type: "fallback",
        proxies: [embyBestName, "DIRECT"],
        url: healthUrl,
        interval: embyInterval
      },

      // AI & Google fixed (manual select)
      {
        name: aiGoogleName,
        type: "select",
        proxies: aiGoogleProxies
      },

      { name: finalName, type: "select", proxies: [globalOutName, "DIRECT"] }
    ],
    rules
  };
}
 
