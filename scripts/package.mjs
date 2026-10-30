import {packager} from '@electron/packager';
import {execFileSync} from 'node:child_process';
const release=process.argv.includes('--release');
if(release) {
  for(const name of ['MACOS_SIGNING_IDENTITY','MACOS_SIGNING_KEYCHAIN','APPLE_ID','APPLE_TEAM_ID','APPLE_APP_SPECIFIC_PASSWORD']) {
    if(!process.env[name]) throw new Error(`Missing release credential: ${name}`);
  }
}
const paths = await packager({
  dir:process.cwd(),out:'build',name:'KVM Workspace',platform:'darwin',arch:'arm64',
  appVersion:process.env.RELEASE_VERSION,
  appBundleId:'com.scarcemedia.kvm-workspace',appCategoryType:'public.app-category.utilities',
  overwrite:true,asar:true,prune:true,
  ignore:[/^\/\.rea(?:\/|$)/,/^\/investigation(?:\/|$)/,/^\/docs(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/\.playwright-mcp(?:\/|$)/,/^\/opencode\.json$/,/^\/\.git(?:hub)?(?:\/|$)/,/^\/build(?:\/|$)/],
  ...(release ? {
    osxSign:{identity:process.env.MACOS_SIGNING_IDENTITY,keychain:process.env.MACOS_SIGNING_KEYCHAIN},
    osxNotarize:{appleId:process.env.APPLE_ID,appleIdPassword:process.env.APPLE_APP_SPECIFIC_PASSWORD,teamId:process.env.APPLE_TEAM_ID}
  } : {}),
  extendInfo:{NSMicrophoneUsageDescription:'Forward your microphone only to KVM sessions you explicitly enable.',NSCameraUsageDescription:'Forward your camera only to KVM sessions you explicitly enable.',NSLocalNetworkUsageDescription:'Connect to the KVM devices saved in your device inventory.'}
});
for (const directory of paths) {
  const app = `${directory}/KVM Workspace.app`;
  if(!release) execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
  execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
  if(release) {
    execFileSync('xcrun',['stapler','validate',app],{stdio:'inherit'});
    execFileSync('spctl',['--assess','--type','execute','--verbose=2',app],{stdio:'inherit'});
  }
  console.log(app);
}
