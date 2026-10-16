import { headers } from "next/headers";
import { redirect } from "next/navigation";
export type AuthorUser={userId:string;displayName:string;fullName:string|null;email:string;isAdmin?:boolean};
export async function getAuthorUser():Promise<AuthorUser|null>{const h=await headers(),id=h.get("oai-authenticated-user-id");return id?{userId:id,displayName:"Ваши статьи",fullName:null,email:"",isAdmin:h.get("oai-authenticated-user-admin")==="1"}:null;}
export async function requireAuthorUser(_path:string){const user=await getAuthorUser();if(!user)redirect("/access");return user;}
export function authorAccessPath(_path="/"){return "/access";}
export function authorSignOutPath(_path="/"){return "/access";}
