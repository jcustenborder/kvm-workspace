'use strict';
// Exercise real packaged UI buttons and IPC with an isolated, disposable profile.
const {_electron}=require('playwright-core');
const {mkdir,mkdtemp,rm}=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

async function run() {
  const root=path.resolve('investigation/private/tmp');
  await mkdir(root,{recursive:true,mode:0o700});
  const profile=await mkdtemp(path.join(root,'inventory-ui-'));
  const bundle=process.argv[2] || path.resolve('build/KVM Workspace-darwin-arm64/KVM Workspace.app');
  const executablePath=path.join(bundle,'Contents/MacOS/KVM Workspace');
  /** @type {import('playwright-core').ElectronApplication | undefined} */
  let application;
  /** @type {string[]} */
  const pageErrors=[];
  try {
    const launchStart=performance.now();
    application=await _electron.launch({executablePath,args:[`--user-data-dir=${profile}`]});
    let page=await application.firstWindow();
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.waitForLoadState('load');

    await page.locator('#add-device').click();
    await page.locator('#device-dialog').waitFor({state:'visible',timeout:3000});
    const launchThroughEditorMs=Math.round(performance.now()-launchStart);
    await page.locator('#device-name').fill('Cancelled device');
    await page.locator('#cancel-device').click();
    await page.locator('#device-dialog').waitFor({state:'hidden'});
    await page.locator('#empty-state').waitFor({state:'visible'});

    await page.locator('#add-first-device').click();
    await page.locator('#device-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#device-name').inputValue(),'');
    await page.locator('#device-name').fill('Inventory UI regression');
    await page.locator('#device-lan').fill('kvm-inventory-test.invalid');
    await page.locator('#device-tailnet').fill('kvm-tailnet-test.invalid');
    await page.locator('#save-device').click();
    await page.locator('#device-dialog').waitFor({state:'hidden'});
    await page.locator('.device-name').filter({hasText:'Inventory UI regression'}).waitFor();
    assert.equal(await page.locator('[data-address="lan"]').innerText(),'https://kvm-inventory-test.invalid');
    assert.equal(await page.locator('[data-address="tailnet"]').innerText(),'https://kvm-tailnet-test.invalid');

    await page.locator('[data-action="edit"]').click();
    assert.equal(await page.locator('#device-name').inputValue(),'Inventory UI regression');
    await page.locator('#device-name').fill('Updated inventory device');
    await page.locator('#save-device').click();
    await page.locator('#device-dialog').waitFor({state:'hidden'});
    await page.locator('.device-name').filter({hasText:'Updated inventory device'}).waitFor();

    await application.close();application=undefined;
    application=await _electron.launch({executablePath,args:[`--user-data-dir=${profile}`]});
    page=await application.firstWindow();
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.locator('.device-name').filter({hasText:'Updated inventory device'}).waitFor();
    await page.locator('#add-device').click();
    await page.locator('#device-dialog').waitFor({state:'visible'});
    await page.locator('#cancel-device').click();
    await page.locator('[data-action="remove"]').click();
    await page.locator('#remove-dialog').waitFor({state:'visible'});
    await page.locator('#confirm-remove').click();
    await page.locator('#empty-state').waitFor({state:'visible'});
    await page.reload();
    await page.locator('#add-device').click();
    await page.locator('#device-dialog').waitFor({state:'visible',timeout:3000});
    await page.locator('#cancel-device').click();
    assert.deepEqual(pageErrors,[],'Inventory must initialize without renderer errors');
    console.log(JSON.stringify({app:bundle,launchThroughEditorMs,checks:['header Add KVM opens editor','cancel leaves inventory unchanged','empty-state Add KVM opens a fresh editor','save persists both routes','edit updates the saved device','saved device survives full application restart','Add KVM works with an existing device','remove returns to the empty state','reload preserves working buttons without renderer errors']},null,2));
  } catch(error) {
    console.error('Inventory UI failure:',error.message);
    console.error('Inventory renderer errors:',JSON.stringify(pageErrors));
    throw error;
  } finally {
    if(application) await application.close();
    await rm(profile,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
