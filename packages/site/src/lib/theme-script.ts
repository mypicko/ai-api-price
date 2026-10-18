/**
 * <head> 内联脚本（STYLE §4.5）：首屏渲染前设置主题和币种，避免暗色模式闪白。
 * 内容固定不变，构建时计算 sha256 写进 CSP（安全项 S12）。
 * 读取 <html> 上的 data-locale / data-alt-href，处理语言偏好：
 * 只有从站外进入（referrer 不同源）且偏好语言与当前页面不同时才跳转。
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,s;try{s=window.localStorage}catch(e){s=null}
var t=s&&s.getItem("theme");var dark=t==="dark"||((t!=="light")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(dark){d.classList.add("dark")}d.style.colorScheme=dark?"dark":"light";
var c=s&&s.getItem("aipb.currency");if(c==="USD"||c==="CNY"){d.setAttribute("data-currency",c)}
var l=s&&s.getItem("aipb.lang"),cur=d.getAttribute("data-locale"),alt=d.getAttribute("data-alt-href");
var ext=!document.referrer||document.referrer.indexOf(location.origin)!==0;
if(ext&&alt&&(l==="zh"||l==="en")&&l!==cur){location.replace(alt+location.search+location.hash)}})();`;
