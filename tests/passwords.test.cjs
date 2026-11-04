'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requirePasswordSession}=require('../src/passwords.cjs');

test('password access belongs to the current main frame at a configured exact device origin',()=>{
  const frame={url:'https://kvm.example/#/login'};
  const contents={mainFrame:frame,getURL:()=>frame.url};
  const item={deviceId:'device-1',endpoint:'https://kvm.example',window:{webContents:contents,isDestroyed:()=>false}};
  const sessions=new Map([['session-1',item]]);
  const devices=[{id:'device-1',name:'Renamable',lan:'https://kvm.example',tailnet:'https://kvm.tailnet.example'}];
  const event={sender:contents,senderFrame:frame};
  assert.equal(requirePasswordSession(event,sessions,devices),item);
  assert.throws(()=>requirePasswordSession({...event,senderFrame:{url:frame.url}},sessions,devices),/session/);
  assert.throws(()=>requirePasswordSession({...event,sender:{}},sessions,devices),/session/);
  for(const url of ['https://kvm.example.attacker/#/login','https://kvm.example:444/#/login','http://kvm.example/#/login']) {
    frame.url=url;
    assert.throws(()=>requirePasswordSession(event,sessions,devices),/session/);
  }
  frame.url='https://kvm.tailnet.example/#/login';item.endpoint='https://kvm.tailnet.example';
  assert.equal(requirePasswordSession(event,sessions,devices),item);
  assert.throws(()=>requirePasswordSession(event,sessions,[]),/session/);
  assert.throws(()=>requirePasswordSession(event,sessions,[{...devices[0],tailnet:''}]),/session/);
});
