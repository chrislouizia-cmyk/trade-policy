'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function StaffWorkspaceLink(){
  const [route,setRoute]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    void createClient().rpc('staff_workspace_route').then(({data})=>{
      if(active && typeof data==='string' && data) setRoute(data);
    });
    return()=>{active=false};
  },[]);
  if(!route)return null;
  return <a className="staff-workspace-link" href={route}>Trade Police HQ</a>;
}
