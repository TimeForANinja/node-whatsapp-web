const WebSocket = require('ws');
const EE = require('events').EventEmitter;
const UTIL = require('./util/main.js');
const DECODER = require('./binary/Decoder.js');

class Client extends EE {
  constructor() {
    super();

    Object.defineProperty(this, '_ws', { value: null, writable: true, configurable: true });
    Object.defineProperty(this, '_encryption', { value: null, writable: true, configurable: true });

    // TODO: add timeout to _messageBuffer
    Object.defineProperty(this, '_messageBuffer', { value: new UTIL.Collection(), writable: true, configurable: true });

    Object.defineProperty(this, 'contacts', { value: new UTIL.Collection(), writable: true, configurable: true });
    Object.defineProperty(this, 'chats', { value: new UTIL.Collection(), writable: true, configurable: true });
    Object.defineProperty(this, 'self', { value: null, writable: true, configurable: true });
  }

  login() {
    this._encryption = UTIL.Encryption.new();
    this._startWS();
  }
  reLogin(sessionData) {
    this._encryption = new UTIL.Encryption(sessionData.CLIENT_ID, sessionData.EC_KEYS_SEED);
    this._encryption.setServerToken(sessionData.SERVER_TOKEN);
    this._encryption.setClientToken(sessionData.CLIENT_TOKEN);
    this._encryption.loadKeys(sessionData.ENC_KEY, sessionData.MAC_KEY);
    this._startWS();
  }

  _startWS() {
    if(this._ws) throw new Error('already logged in');
    this._ws = new WebSocket('wss://web.whatsapp.com/ws', {
      origin: 'https://web.whatsapp.com'
    });
    this._ws.on('open', this._onWSOpen.bind(this));
    this._ws.on('message', this._onWSMessage.bind(this));
    this._ws.on('close', this._onWSClose.bind(this));
    this._ws._pingInterval = setInterval(() => {
      this.emit('ping');
      this._ws.send('?,,');
    }, 15 * 1000);
  }

  getCredentials() {
    if(!this._encryption) return null;
    return this._encryption.serialize();
  }

// TODO: destory()
  destroy() {}

  _onWSMessage(data) {
    if(typeof data !== 'string') return this._onWSMessage_Encrypted(data);
    if(data.match(/^![0-9]+$/)) return this.emit('pong'); // beacon response
    const parts = data.split(/\,(.*)/).splice(0,2);
    let payload;
    try {
      payload = JSON.parse(parts[1]);
      // TODO: handle Error
    } catch(e) {}

    // TODO: make this way more precise
    if(['Blocklist', 'Stream', 'Props'].includes(payload[0])) return;
    if(payload[0] === 'Conn') return this._onWSMessage_Authentication(payload);
    if(payload[0] === 'Cmd' && payload[1].type === 'challenge') return this._onWSMessage_Challenge(parts[0], payload)

    // TODO: filter out "takes more time" messages
    if(this._messageBuffer.has(parts[0])) {
      this._messageBuffer.get(parts[0]).resolve(payload || parts[1]);
      this._messageBuffer.delete(parts[0]);
    } else {
      console.log('unknown message', {data, payload});
    }
  }
  _onWSMessage_Authentication(payload) {
    console.log('_onWSMessage_Authentication', { payload });
    this._encryption.setServerToken(payload[1].serverToken);
    this._encryption.setClientToken(payload[1].clientToken);
    // TODO: build client.self object from data provided with request
    console.log('_onWSMessage_Authentication', {
      payload,
      usable: this._encryption.usable
    });
    if(!this._encryption.usable) {
      this._encryption.buildNewPair(payload[1].secret);
    }
    this.emit('online');
    this.emit('credentials', this._encryption.serialize());
  }
  _onWSMessage_Challenge(messageTag, payload) {
    const challenge = Buffer.from(payload[1].challenge, 'base64');
    const sign = this._encryption.HmacSha256(challenge);
    this._WSsendMsg(
      'admin',
      'challenge',
      Buffer.concat([sign, challenge]).toString('base64'),
      this._encryption.getServerToken(),
      this._encryption.getClientID()
    );
    this.emit('challenged');
  }
  _onWSMessage_Encrypted(data) {
    const id_seperator = Uint8Array.from(data).indexOf(44);
    const id = data.slice(0, id_seperator);
    const msg_content = data.slice(id_seperator+1);
    const sig = this._encryption.HmacSha256(msg_content.slice(32));
    // TODO: also log the message
    if(!sig.equals(msg_content.slice(0, 32))) throw new Error('invalid signature');
    const content = this._encryption.AESDecrypt(msg_content.slice(32));
    const decoded = DECODER(content);
    if(decoded instanceof Error) return console.error(decoded);

    if(decoded.Description === 'response') {
      const type = decoded.Attributes.get('type');
      if(type === 'chat') {
        // list of all chats
        return
      }
      if(type === 'contacts') {
        // list of all contacts
        return
      }
    }
    if(decoded.Description === 'action') {
      if(decoded.Content.map(a => a.Description).unDoub().length === 0 && decoded.Content[0].Description === 'message') {
        // messages to add to chats
        return
      }
    }

    console.error('unknown encrypted message', {
      Description: decoded.Description,
      Attributes: decoded.Attributes,
      FirstItem: decoded.Content ? decoded.Content[0] : null,
    });
  }
// TODO: _onWSDestroy()
  _onWSDestroy() {}
// TODO: _onWSOpen()
  async _onWSOpen() {
    const r1 = await this._WSsendMsg('admin', 'init', [0,3,2846], ['Linux', 'NodeJS'], this._encryption.getClientID(), true)
    if(Number(r1.status) !== 200) throw new Error(`init failed with statusCode ${r1.status}`);
    if(this._encryption.usable) {
      const r2 = await this._WSsendMsg('admin', 'login', this._encryption.getClientToken(), this._encryption.getServerToken(), this._encryption.getClientID(), 'takeover');
      if(Number(r2.status) !== 200) throw new Error(`takeover failed with statusCode ${r2.status}`);
    } else {
      // TODO: r1.ttl is the max age of the qr code
      this.emit('qr', `${r1.ref},${Buffer.from(this._encryption._ecKeys.public).toString('base64')},${this._encryption.getClientID()}`);
    }
  }
// TODO: _onWSClose()
  _onWSClose() {
    this.emit('offline');
  }

  _WSsendMsg(categorie, ...data) {
    return new Promise((resolve, reject) => {
      const id = UTIL.buildID();
      this._ws.send(`${id},${JSON.stringify([categorie, ...data])}`);
      this._messageBuffer.set(id, {resolve, reject, time: Date.now()});
    });
  }
}
module.exports = Client;
