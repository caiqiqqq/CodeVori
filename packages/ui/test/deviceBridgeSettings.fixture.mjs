import { writeFile } from "node:fs/promises";

export async function writeDeviceBridgeSettingsFixture(html, moduleFile, name) {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfirmDialogHost} from '../../../ui/src/ConfirmDialog.tsx';
    import {SettingsPage} from '../../../ui/src/SettingsPage.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {setPendingSettingsSectionIntent} from '../../../ui/src/lib/settingsNavigation.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],fail:false,hold:false,snapshot:{binaryPath:'/synthetic/device-bridge',phase:'stopped',backendState:'Stopped',canLogin:false,nodeId:'',dnsName:'',loginName:'',tailnet:'',exposing:false,managementConfigured:false,peers:[]}};
    window.__devices=state;state.setTheme=applyTheme;state.intent=setPendingSettingsSectionIntent;
    state.authorize=()=>{state.nodeAuthorized=true;Object.assign(state.snapshot,{backendState:'Running',canLogin:false,nodeId:'mac',dnsName:'mac.example.ts.net',loginName:'synthetic@example.test',tailnet:'synthetic',peers:[{nodeId:'windows',name:'Windows workstation '+ 'long-name-'.repeat(12),os:'windows',online:true,connected:false,allowed:false},{nodeId:'offline',name:'Offline workstation',os:'windows',online:false,connected:false,allowed:false}]})};
    const platform:any={
      openExternal:(url:string)=>{(state.externalUrls??=[]).push(url)},
      getDeviceBridgeState:async()=>structuredClone(state.snapshot),
      inspectDeviceBridge:async(request:any)=>{
        (state.inspections??=[]).push(request);
        if(state.holdInspection){state.holdInspection=false;await new Promise(resolve=>state.releaseInspection=resolve)}
        if(state.inspectionError)throw Error('synthetic-private-observation-error');
        if(request.kind==='screen')return {kind:'screen',nodeId:request.nodeId,sampledAt:new Date().toISOString(),mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII='};
        return {kind:'system',nodeId:request.nodeId,status:{sampledAt:new Date().toISOString(),platform:'windows',architecture:'amd64',cpuCount:8,cpuModel:'Synthetic CPU',cpuPercent:25,memory:{totalBytes:17179869184,usedBytes:8589934592,availableBytes:8589934592},processCount:120,inspectedProcessCount:100,processesPartial:true,processes:[{pid:42,name:'example-'+ 'long-process-name-'.repeat(10)+'.exe',rssBytes:268435456,cpuSeconds:12.3}]}};
      },
      executeDeviceBridgeCommand:async(command:any)=>{
        state.calls.push(command);if(state.hold){state.hold=false;await new Promise(resolve=>state.release=resolve)}
        if(command.action==='start' && state.startError){
          Object.assign(state.snapshot,{phase:'error',error:state.startError});
          throw new Error("Error invoking remote method 'zcode:execute-device-bridge-command': Error: "+state.startError);
        }
        if(state.fail){state.fail=false;throw new Error(state.failCode || 'Synthetic device failure')}
        const s=state.snapshot,p=s.peers.find((p:any)=>p.nodeId===command.nodeId);
        switch(command.action){
          case 'download-node':(state.externalUrls??=[]).push('https://aimodetest.cn/codevori-node/clients/current/CodeVoriNode-'+command.platform+(command.platform.startsWith('win32-')?'.exe':''));break;
          case 'configure-management':s.managementConfigured=true;break;
          case 'clear-management':s.managementConfigured=false;break;
          case 'remove':s.peers=s.peers.filter((p:any)=>p.nodeId!==command.nodeId);break;
          case 'configure':s.binaryPath=command.binaryPath;s.phase='stopped';delete s.error;break;
          case 'start':Object.assign(s,{phase:'running',backendState:'NeedsLogin',canLogin:true});if(state.nodeAuthorized)state.authorize();delete s.error;break;
          case 'connect':Object.assign(p,{connected:true,toolCount:7,checkedAt:'2026-10-22T00:00:00Z'});break;
          case 'disconnect':p.connected=false;delete p.toolCount;delete p.checkedAt;break;
          case 'authorize':p.allowed=command.allowed;s.exposing=p.allowed;break;
          case 'logout':state.nodeAuthorized=false;s.managementConfigured=false;
          case 'stop':Object.assign(s,{phase:'stopped',backendState:'Stopped',canLogin:false,loginName:'',dnsName:'',peers:[]});break;
        }
        return structuredClone(s);
      },
      selectFile:async()=>'/synthetic/replacement-device-bridge',
      onSettingsChanged:()=>()=>{},selectDirectory:async()=>null,
    };
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({})},systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},broadcastService:broadcast};
    function Fixture(){
      const [mode,setMode]=useState('desktop'),[locale,setLocale]=useState('zh-CN'),[generation,setGeneration]=useState(0);
      state.setMode=setMode;state.setLocale=setLocale;state.remount=()=>setGeneration(v=>v+1);
      return <PlatformProvider platform={mode==='desktop'?platform:{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><ConfirmDialogHost/><SettingsPage key={mode+generation} isDesktop={mode==='desktop'} isMacDesktop={mode==='desktop'}/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
    }
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `,
  );
}
