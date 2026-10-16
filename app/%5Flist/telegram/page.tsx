import {notFound} from 'next/navigation';
import {requireAuthorUser} from '@/app/author-access';
import {isAdminUser} from '@/lib/operations';
import TelegramSetup from '@/app/components/telegram-setup';
export const dynamic='force-dynamic';
export default async function TelegramPage(){const user=await requireAuthorUser('/_list/telegram');if(!isAdminUser(user))notFound();return <TelegramSetup/>;}
