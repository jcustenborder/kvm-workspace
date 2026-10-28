import {packager} from '@electron/packager';
import {execFileSync} from 'node:child_process';
const paths = await packager({
  dir:process.cwd(),out:'build',name:'KVM Workspace',platform:'darwin',arch:'arm64',
  appBundleId:'com.scarcemedia.kvm-workspace',appCategoryType:'public.app-category.utilities',
  overwrite:true,asar:true,prune:true,
  ignore:[/^\/\.rea(?:\/|$)/,/^\/investigation(?:\/|$)/,/^\/docs(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/\.playwright-mcp(?:\/|$)/,/^\/opencode\.json$/,/^\/\.git(?:\/|$)/,/^\/build(?:\/|$)/],
  extendInfo:{NSMicrophoneUsageDescription:'Forward your microphone only to KVM sessions you explicitly enable.',NSCameraUsageDescription:'Forward your camera only to KVM sessions you explicitly enable.',NSLocalNetworkUsageDescription:'Connect to the KVM devices saved in your device inventory.'}
});
for (const directory of paths) {
  const app = `${directory}/KVM Workspace.app`;
  execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
  execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
  console.log(app);
}
