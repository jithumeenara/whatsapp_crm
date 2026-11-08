/**
 * An inline script for the root layout: when one of the app's own script
 * files fails to load (a tab opened before a server update asks for the old
 * build's files, which are gone), reload the page once to get the new ones.
 *
 * Why inline and not a React component: when the app's JavaScript cannot
 * load, React never starts, so a component guard would never run — that was
 * the blank login page. This plain script runs before any of it.
 *
 * Never loops: it reloads at most once a minute per tab, and not at all when
 * the browser blocks sessionStorage (it cannot remember that it tried).
 */
export const CHUNK_RELOAD_KEY = 'crm-chunk-reload'

export const CHUNK_RELOAD_SCRIPT = `(function(){
var K=${JSON.stringify(CHUNK_RELOAD_KEY)};
function retry(){
  try{
    var last=Number(sessionStorage.getItem(K))||0;
    if(Date.now()-last<60000)return;
    sessionStorage.setItem(K,String(Date.now()));
  }catch(_){return}
  location.reload();
}
function chunkText(s){return /ChunkLoadError|Loading (CSS )?chunk|Failed to load chunk/.test(String(s||''))}
addEventListener('error',function(e){
  var t=e&&e.target;
  var src=t&&t.tagName==='SCRIPT'?t.src:t&&t.tagName==='LINK'?t.href:'';
  if((src&&src.indexOf('/_next/static/')!==-1)||chunkText(e&&e.message))retry();
},true);
addEventListener('unhandledrejection',function(e){
  var r=e&&e.reason;
  if(r&&(r.name==='ChunkLoadError'||chunkText(r.message)))retry();
});
})();`
