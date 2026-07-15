import LoginForm from '@/components/LoginForm';
export default async function LoginPage({searchParams}:{searchParams:Promise<{next?:string}>}){
  const params=await searchParams;
  const next=params.next?.startsWith('/')?params.next:'/validate';
  return <LoginForm next={next}/>;
}
