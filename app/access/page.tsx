'use client';
import {useEffect,useState} from 'react';
export default function Access(){
 const [message,setMessage]=useState(''),[bot,setBot]=useState(''),[busy,setBusy]=useState(false),[owner,setOwner]=useState(false);
 useEffect(()=>{
  const parameters=new URLSearchParams(window.location.hash.slice(1)),ticket=parameters.get('ticket');
  if(ticket){
   const destination=parameters.get('next')==='telegram'?'/_list/telegram':'/_list/admin';
   window.history.replaceState(null,'','/access');setBusy(true);
   fetch('/api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ticket',ticket})}).then(async r=>{
    const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error||'Не удалось открыть доступ владельца.');window.location.replace(destination);
   }).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));
  }
  fetch('/api/access').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{
   if(!d||typeof d!=='object')throw new Error();
   setBot('telegram' in d&&typeof d.telegram==='string'?d.telegram:'');setOwner('owner' in d&&d.owner===true);
  }).catch(()=>setMessage('Не удалось проверить доступ. Обновите страницу.'));
 },[]);
 return <main className="about-page access-page"><a className="wordmark" href="/">Letro<span className="wordmark-dot">.</span></a><h1>Где находятся ваши статьи</h1>{busy&&<p role="status">Открываем доступ владельца…</p>}{message&&<p className="access-message" role="status">{message}</p>}{owner&&<section aria-label="Доступ владельца"><h2>Управление сервисом</h2><p>Доступ владельца подтверждён. Он открывает настройки сервиса отдельно от ваших статей.</p><p><a className="btn btn-primary" href="/_list/telegram">Настроить Telegram-бота</a></p><p><a href="/_list/admin">Панель управления</a></p></section>}<h2>В этом браузере</h2><p className="about-lead">Статьи, созданные здесь, доступны для редактирования на этом устройстве в этом же браузере.</p><p>Сохраняйте данные сайта: после их очистки или в режиме инкогнито доступ может потеряться. Другой браузер получает отдельное пространство.</p><a className="btn btn-primary" href="/">Открыть редактор</a><h2>В Telegram</h2><p>Откройте бота и нажмите /start. Кнопки «Мои статьи», «Новая статья» и «Удалить статью» работают с вашим Telegram-пространством. Доступ определяется автоматически по Telegram, без ключей и пароля.</p><p>Статьи из обычного браузера не переносятся и не привязываются к боту.</p>{bot&&<a className="btn btn-light" href={'https://t.me/'+bot}>Открыть @{bot}</a>}</main>;
}
