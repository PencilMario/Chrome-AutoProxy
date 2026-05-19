export const DEFAULT_CONFIG = {
  enabled: false,
  activeProxyId: "local-socks",
  proxies: [
    {
      id: "local-socks",
      name: "Local SOCKS5",
      type: "SOCKS5",
      host: "127.0.0.1",
      port: 7890
    }
  ],
  rules: {
    direct: [
      "localhost",
      "*.local",
      "baidu.com",
      "*.baidu.com",
      "qq.com",
      "*.qq.com",
      "weixin.qq.com",
      "wechat.com",
      "*.wechat.com",
      "taobao.com",
      "*.taobao.com",
      "tmall.com",
      "*.tmall.com",
      "alicdn.com",
      "*.alicdn.com",
      "aliyun.com",
      "*.aliyun.com",
      "jd.com",
      "*.jd.com",
      "bilibili.com",
      "*.bilibili.com",
      "zhihu.com",
      "*.zhihu.com",
      "douyin.com",
      "*.douyin.com",
      "toutiao.com",
      "*.toutiao.com",
      "163.com",
      "*.163.com",
      "126.com",
      "*.126.com",
      "sina.com.cn",
      "*.sina.com.cn",
      "weibo.com",
      "*.weibo.com",
      "mi.com",
      "*.mi.com",
      "xiaomi.com",
      "*.xiaomi.com",
      "huawei.com",
      "*.huawei.com",
      "meituan.com",
      "*.meituan.com",
      "dianping.com",
      "*.dianping.com",
      "amap.com",
      "*.amap.com",
      "douban.com",
      "*.douban.com",
      "cn",
      "*.cn",
      "中国",
      "*.中国"
    ],
    proxy: [
      "*.google.com",
      "*.youtube.com",
      "*.github.com",
      "chatgpt.com",
      "*.chatgpt.com",
      "*.openai.com",
      "*.oaistatic.com",
      "*.oaiusercontent.com"
    ]
  },
  geoip: {
    mode: "proxyNonLocal",
    localCountries: [
      "CN"
    ],
    cacheSeedImported: false
  },
  debug: {
    enabled: false
  }
};

export function mergeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    proxies: Array.isArray(config.proxies) && config.proxies.length ? config.proxies : DEFAULT_CONFIG.proxies,
    rules: {
      ...DEFAULT_CONFIG.rules,
      ...(config.rules || {})
    },
    geoip: {
      ...DEFAULT_CONFIG.geoip,
      ...(config.geoip || {})
    },
    debug: {
      ...DEFAULT_CONFIG.debug,
      ...(config.debug || {})
    }
  };
}
