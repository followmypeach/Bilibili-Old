import { debug } from "../debug";
import { objUrl, urlObj } from "../format/url";

const appendChild = Element.prototype.appendChild;
const insertBefore = Element.prototype.insertBefore;
const jsonp: [string[], Function][] = [];
Element.prototype.appendChild = function <T extends Node>(newChild: T): T {
    this.parentElement === document.documentElement && newChild.nodeName == 'SCRIPT' && (<any>newChild).src && (jsonp.forEach(d => {
        d[0].every(d => (<any>newChild).src.includes(d)) && d[1].call(newChild);
    }));
    return <T>appendChild.call(this, newChild);
};
Element.prototype.insertBefore = function <T extends Node>(newChild: T, refChild: Node | null): T {
    this.parentElement === document.documentElement && newChild.nodeName == 'SCRIPT' && (<any>newChild).src && (jsonp.forEach(d => {
        d[0].every(d => (<any>newChild).src.includes(d)) && d[1].call(newChild);
    }));
    return <T>insertBefore.call(this, newChild, refChild);
}
/**
 * 注册拦截修改jsonp请求，本方法必须传入同步返回的回调函数，要使用异步回调请考虑方法`async`。
 * @param url 需要拦截的xhr的url匹配关键词或词组，词组间是并的关系，即必须同时满足才会触发拦截回调。
 * @param redirect 重定向url的回调函数，将原url作为第一个参数传递，必须同步返回重定向后的url。
 * @param modifyResponse 修改jsonp返回值的回调函数，将原返回值(一般为json格式)作为第一个参数传递，必须同步返回修改后的返回值。原url作为第二个参数，但由于结果已返回修改url并没有效果。
 * @param once 为节约性能开销，默认只拦截符合条件的xhr**一次**后便会注销，如果要多次拦截，请传递`false`，然后自行使用返回值（方法）取消拦截。
 * @returns 取消拦截的方法
 */
export function jsonpHook(url: string | string[], redirect?: (url: string) => string, modifyResponse?: (response: any, url: string, call: (res: any) => void) => any, once = true) {
    let id: number;
    const one = Array.isArray(url) ? url : [url];
    const two = function (this: HTMLScriptElement) {
        once && id && delete jsonp[id - 1];
        if (redirect) try { this.src = redirect(this.src) || this.src } catch (e) { debug.error("redirect of jsonphook", one, e) }
        if (modifyResponse) {
            const obj = urlObj(this.src);
            if (obj) {
                const callback: any = obj.callback;
                const call: any = window[callback];
                const url = this.src;
                if (call) {
                    (<any>window)[callback] = function (v: any) {
                        try { v = modifyResponse(v, url, call) || v } catch (e) { debug.error("modifyResponse of jsonphook", one, e) }
                        return v !== true && call(v);
                    }
                }
            }
        }
    };
    const iid = jsonp.push([one, two]);
    return () => { removeJsonphook(iid) };
}
/**
 * `jsonphook`的异步版本，可以用异步方法获取到的返回值替换jsonp请求的返回值。
 * @param url 需要拦截的xhr的url匹配关键词或词组，词组间是并的关系，即必须同时满足才会触发拦截回调。
 * @param condition 二次判定**同步**回调函数，不提供或者返回真值时开始拦截，可以通过url等精确判定是否真要拦截。
 * @param modifyResponse 修改jsonp返回值的回调函数，将原url作为第一个参数传递，请将要设定的jsonp返回值返回，格式一般都是json。
 * @param once 为节约性能开销，默认只拦截符合条件的xhr**一次**后便会注销，如果要多次拦截，请传递`false`，然后自行使用返回值（方法）取消拦截。
 * @returns 取消拦截的方法
 */
jsonpHook.async = (url: string | string[], condition?: (url: string) => boolean, modifyResponse?: (url: string) => Promise<any>, once = true) => {
    let id: number;
    const one = Array.isArray(url) ? url : [url];
    const two = function (this: HTMLScriptElement) {
        try {
            once && id && delete jsonp[id - 1];
            if (!condition || condition(this.src)) {
                const obj = urlObj(this.src);
                if (obj) {
                    const callback: any = obj.callback;
                    const call = (<any>window)[callback];
                    if (call) {
                        modifyResponse && modifyResponse(this.src).then(d => {
                            (<any>window)[callback](d);
                            this.dispatchEvent(new ProgressEvent("load"));
                        }).catch(e => {
                            this.dispatchEvent(new ProgressEvent("error"));
                            debug.error("modifyResponse of xhrhookasync", one, e);
                        })
                    }
                    this.removeAttribute("src");
                }
            }
        } catch (e) { debug.error("jsonphook", one, e) }
    }
    const iid = jsonp.push([one, two]);
    return () => { removeJsonphook(iid) };
}
/**
 * 禁止脚本注入运行。
 * @param url 要禁止运行的脚本src匹配关键词或词组，词组间是并的关系，即必须同时满足才会触发拦截回调。
 */
jsonpHook.scriptBlock = (url: string | string[]) => {
    const one = Array.isArray(url) ? url : [url];
    const two = function (this: HTMLScriptElement) {
        try {
            this.removeAttribute("src");
            setTimeout(() => {
                // 谎报完成事件并主动移除script节点
                this.dispatchEvent(new ProgressEvent("load"));
                try { this.remove() } catch (e) { }
            }, 100);
        } catch (e) { debug.error("脚本拦截失败！", one, e) }
    }
    jsonp.push([one, two]);
}
/**
 * 注册拦截脚本注入，本方法只能拦截通过`appendChild`等方法传入页面的脚本。  
 * 若要解除拦截，可通过`removeJsonphook`取消拦截，参数为本方法返回的id。
 * @param url 需要拦截的脚本的src匹配关键词或词组，词组间是并的关系，即必须同时满足才会触发拦截回调。
 * @param redirect 替换src的回调函数，将原src作为第一个参数，必须同步返回重定向的src。
 * @param text 要以内联脚本形式替换的回调函数，将原src作为第一个参数，必须同步返回替换的代码文本。本参数的存在将导致`redirect`被忽略。
 * @returns 取消拦截的方法
 */
jsonpHook.scriptIntercept = (url: string | string[], redirect?: (url: string) => string, text?: (url: string) => string) => {
    const one = Array.isArray(url) ? url : [url];
    const two = function (this: HTMLScriptElement) {
        try {
            if (text) {
                this.text = text(this.src);
                this.removeAttribute("src");
                setTimeout(() => {
                    this.dispatchEvent(new ProgressEvent("load"));
                    this?.remove();
                }, 100);
            } else if (redirect) {
                this.src = redirect(this.src);
            }
        } catch (e) { debug.error("scriptIntercept", one, e) }
    }
    const iid = jsonp.push([one, two]);
    return () => { removeJsonphook(iid) };
}
/**
 * 取消jsonphook或脚本拦截，只在注册时设置了`once=false`时才需要使用本方法！
 * @param id 要取消注册的id，该值为注册时返回值，一个id只允许使用一次！
 */
function removeJsonphook(id: number) {
    id >= 0 && delete jsonp[id - 1];
}

/**
 * jsonp转xhr，改用fetch请求，可用于修复受损的jsonp请求
 * 
 * @param url 需要拦截的脚本的src匹配关键词或词组，词组间是并的关系，即必须同时满足才会触发拦截回调。
 * @returns 取消拦截的方法
 */
jsonpHook.xhr = (url: string | string[]) => {
    const one = Array.isArray(url) ? url : [url];
    const two = function (this: HTMLScriptElement) {
        try {
            // "https://s.search.bilibili.com/main/suggest?jsoncallback=jqueryCallback_bili_6048207588082448&func=suggest&suggest_type=accurate&sub_type=tag&main_ver=v1&highlight=&userid=49811844&bangumi_acc_num=1&special_acc_num=1&topic_acc_num=1&upuser_acc_num=3&tag_num=10&special_num=10&bangumi_num=10&upuser_num=3&term=&rnd=0.19763260300544117&_=1699787584468"
            const obj = urlObj(this.src);
            if (obj) {
                const callback: any = obj.callback || obj.jsoncallback;
                const call: any = window[callback];
                const url = this.src;
                this.removeAttribute("src");
                delete obj.callback;
                delete obj.jsoncallback;
                fetch(objUrl(url.split('?')[0], obj))
                    .then(d => d.json())
                    .then(d => {
                        call(d);
                        this.dispatchEvent(new ProgressEvent("load"));
                    })
                    .catch(() => {
                        this.dispatchEvent(new ProgressEvent("error"));
                    });
            }
        } catch (e) { debug.error("jsonphook", one, e) }
    }
    const iid = jsonp.push([one, two]);
    return () => { removeJsonphook(iid) };
}