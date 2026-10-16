"use client";
import { useState } from "react";
import Editor from "./editor";
import { blankArticle, type Article } from "@/lib/article";
type User={userId:string;fullName:string|null;displayName:string;isAdmin?:boolean};
export default function Workspace({initialUser,initial}:{initialUser:User|null;initial:Article}){
 const [user,setUser]=useState(initialUser),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function start(){setBusy(true);setError("");try{const response=await fetch("/api/access",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create"})});const data=await response.json() as {error?:string;user:User};if(!response.ok)throw new Error(data.error||"Не удалось открыть редактор.");setUser(data.user);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(user)return <Editor user={user} initial={initialUser?initial:blankArticle()} signIn="/access" signOut="/access" adminAllowed={user.isAdmin}/>;
 return <main className="start-page"><a className="wordmark" href="/">лист<span className="wordmark-dot">.</span></a><span className="start-eyebrow">ПИШИТЕ. ДЕЛИТЕСЬ. ОСТАВАЙТЕСЬ СОБОЙ.</span><h1>Ваша история.<br/>По вашей ссылке.</h1><p>Превратите текст в красивую статью. Выберите оформление и собственный адрес — и поделитесь им.</p><button className="btn btn-primary" disabled={busy} onClick={()=>void start()}>{busy?"Открываем лист…":"Начать писать"}</button><a className="btn btn-light" href="/demo">Посмотреть пример</a>{error&&<p role="alert">{error}</p>}<p className="start-hint">Без регистрации и пароля. Доступ к редактированию сохраняется в этом браузере. Статьи из Telegram доступны отдельно через бота.</p><a href="/access">Вернуться к своим статьям</a></main>;
}
