import Editor from "./components/editor";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
import { demoArticle } from "@/lib/article";
import { isAdminUser } from "@/lib/operations";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  return <Editor user={user} initial={demoArticle()} signIn={chatGPTSignInPath("/")} signOut={chatGPTSignOutPath("/")} adminAllowed={isAdminUser(user)} />;
}
