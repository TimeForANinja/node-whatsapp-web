const WhatsApp = require('.');
const PATH = require('path');
const FS = require('fs');

const credFile = PATH.resolve(__dirname, './creds.pem');

const c = new WhatsApp();

c.on('qr', ref => {
  console.log('event qr', {ref});
});
c.on('challenged', () => {
  console.log('event challenged');
});
c.on('credentials', creds => {
  FS.writeFileSync(credFile, JSON.stringify(creds));
  console.log('event credentials', {creds});
});
c.on('online', () => {
  console.log('event online');
});
c.on('offline', () => {
  console.log('event offline');
});

c.reLogin(JSON.parse(FS.readFileSync(credFile)));
// c.login();
