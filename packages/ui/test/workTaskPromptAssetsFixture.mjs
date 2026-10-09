// Injected into the existing isolated Host fixture, never the real workspace.
export const workTaskPromptAssetsFixture = String.raw`
    state.uploads = new Map(); state.assets = new Map(); state.localFiles = new Map();
    state.createdPreviewUrls=[]; state.revokedPreviewUrls=[];
    const createPreviewUrl=URL.createObjectURL.bind(URL), revokePreviewUrl=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=(blob:Blob)=>{const url=createPreviewUrl(blob);state.createdPreviewUrls.push(url);return url};
    URL.revokeObjectURL=(url:string)=>{state.revokedPreviewUrls.push(url);revokePreviewUrl(url)};
    state.delayReadPaths=new Set();state.pendingFileReads=[];
    state.finishFileReads=(path:string)=>{const reads=state.pendingFileReads.filter((r:any)=>r.path===path);state.pendingFileReads=state.pendingFileReads.filter((r:any)=>r.path!==path);state.delayReadPaths.delete(path);for(const read of reads)read.finish()};
    state.fileEntries = [
      {type:'file',name:'main.ts',relativePath:'src/main.ts',path:'/synthetic/project/src/main.ts'},
      {type:'file',name:'spec.md',relativePath:'docs/spec.md',path:'/synthetic/project/docs/spec.md'}
    ];
    const digest = async (bytes:any) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const uploadKey = (r:any) => JSON.stringify([r.workspacePath,r.uploadId]);
    Object.assign(service, {
      async attachmentBegin(r:any) {
        state.calls.push({op:'attachment-begin',...r});
        const old=state.uploads.get(uploadKey(r));
        if(old?.ref) return {uploadId:r.uploadId,state:'committed',ref:old.ref,nextChunkIndex:old.chunks.length};
        state.uploads.set(uploadKey(r),{input:clone(r),chunks:[],ref:null});
        return {uploadId:r.uploadId,state:'staging',nextChunkIndex:0};
      },
      async attachmentChunk(r:any) {
        state.calls.push({op:'attachment-chunk',uploadId:r.uploadId,chunkIndex:r.chunkIndex,base64Length:r.dataBase64.length});
        if(state.failUpload){state.failUpload=false;throw new Error('Synthetic attachment upload failed')}
        const upload=state.uploads.get(uploadKey(r));
        if(r.chunkIndex!==upload.chunks.length)throw new Error('Invalid chunk order');
        upload.chunks.push(Uint8Array.from(atob(r.dataBase64),c=>c.charCodeAt(0)));
        return {uploadId:r.uploadId,nextChunkIndex:upload.chunks.length};
      },
      async attachmentCommit(r:any) {
        state.calls.push({op:'attachment-commit',...r});
        const upload=state.uploads.get(uploadKey(r));
        if(upload.ref)return {ref:upload.ref};
        const bytes=new Uint8Array(upload.input.totalBytes); let offset=0;
        for(const chunk of upload.chunks){bytes.set(chunk,offset);offset+=chunk.length}
        if(offset!==bytes.length || upload.input.checksum!==await digest(bytes))throw new Error('Invalid uploaded bytes');
        upload.ref='/synthetic/task-attachments/'+r.uploadId+'/'+upload.input.fileName;
        state.assets.set(upload.ref,bytes);
        return {ref:upload.ref};
      },
      async attachmentAbort(r:any) {
        state.calls.push({op:'attachment-abort',...r});
        const upload=state.uploads.get(uploadKey(r)); if(!upload?.ref)state.uploads.delete(uploadKey(r));
      },
      async attachmentImport(r:any) {
        state.calls.push({op:'attachment-import',...r});
        const bytes=state.localFiles.get(r.localPath);
        if(!bytes)throw new Error('Synthetic missing local file');
        const ref='/synthetic/task-attachments/local-'+state.assets.size+'/'+r.fileName;
        state.assets.set(ref,bytes.slice());
        return {ref,fileName:r.fileName,mime:r.mime,bytes:bytes.length};
      }
    });
    services.fileService = {
      async searchWorkspaceFiles(r:any){state.calls.push({op:'file-search',...r});return state.fileEntries.filter((f:any)=>f.relativePath.toLowerCase().includes(r.query.toLowerCase()))},
      async stat(r:any){state.calls.push({op:'file-stat',...r});const bytes=state.assets.get(r.path)??state.localFiles.get(r.path);if(!bytes)throw new Error('File not found');return {type:'file',size:bytes.length}},
      async readFileRange(r:any){state.calls.push({op:'file-read',...r});const bytes=state.assets.get(r.path)??state.localFiles.get(r.path);if(!bytes)throw new Error('File not found');if(state.delayReadPaths.has(r.path))await new Promise<void>(finish=>state.pendingFileReads.push({path:r.path,finish}));return bytes.slice(r.offset,r.offset+r.length)}
    };
    state.replaceFileHost=()=>{services.fileService={...services.fileService};changed()};
    services.promptAttachmentTransferService = new Proxy({}, {get:(_,method)=>async()=>{state.calls.push({op:'agent-transfer-'+String(method)});throw new Error('Task drafts must never use Agent transfer')}});
    services.clientConfigService={async getSnapshot(){state.calls.push({op:'forbidden-client-config'});throw new Error('Files-only task drafts must not load a plugin catalog')}};
    services.zcodeAgentService = new Proxy({}, {get:(_,method)=>async()=>{state.calls.push({op:'agent-'+String(method)});throw new Error('Task drafts must never connect to an Agent')}});
    platform.canSelectFilePath=false;
    platform.selectFiles=async()=>state.selectedPaths??[];
    state.nativePicker=(paths:any)=>{state.selectedPaths=paths;platform.canSelectFilePath=!!paths};
`;
