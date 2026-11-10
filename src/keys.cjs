'use strict';
// Browser code/key/legacy keyCode triples used by firmware keyboard handlers.
const keys={
  MetaLeft:['Meta',91],MetaRight:['Meta',92],ControlLeft:['Control',17],ControlRight:['Control',17],
  ShiftLeft:['Shift',16],ShiftRight:['Shift',16],AltLeft:['Alt',18],AltRight:['Alt',18],
  Enter:['Enter',13],Escape:['Escape',27],Tab:['Tab',9],Space:[' ',32],Backspace:['Backspace',8],
  Delete:['Delete',46],Insert:['Insert',45],Home:['Home',36],End:['End',35],PageUp:['PageUp',33],PageDown:['PageDown',34],
  ArrowLeft:['ArrowLeft',37],ArrowUp:['ArrowUp',38],ArrowRight:['ArrowRight',39],ArrowDown:['ArrowDown',40],
  CapsLock:['CapsLock',20],PrintScreen:['PrintScreen',44],ScrollLock:['ScrollLock',145],Pause:['Pause',19],
  Backquote:['`',192],Minus:['-',189],Equal:['=',187],BracketLeft:['[',219],BracketRight:[']',221],
  Backslash:['\\',220],Semicolon:[';',186],Quote:["'",222],Comma:[',',188],Period:['.',190],Slash:['/',191],
};
for(let code=65;code<=90;code++) keys[`Key${String.fromCharCode(code)}`]=[String.fromCharCode(code+32),code];
for(let digit=0;digit<=9;digit++) keys[`Digit${digit}`]=[String(digit),48+digit];
for(let number=1;number<=12;number++) keys[`F${number}`]=[`F${number}`,111+number];
module.exports={keys};
