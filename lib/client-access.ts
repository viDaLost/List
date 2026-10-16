export function inTelegramWorkspace(){return typeof window!=='undefined'&&window.location.pathname==='/_list/app';}
export function clientFetch(url:string,init:RequestInit={}){const headers=new Headers(init.headers);if(inTelegramWorkspace())headers.set('x-list-context','telegram');return fetch(url,{...init,headers});}
