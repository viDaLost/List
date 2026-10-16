import Workspace from "./components/workspace";
import { getAuthorUser } from "./author-access";
import { blankArticle } from "@/lib/article";
export const dynamic="force-dynamic";
export default async function Home(){return <Workspace initialUser={await getAuthorUser()} initial={blankArticle()}/>;}
