const UTIL = require('../util/main.js');

class BinaryDecoder {
  constructor(bytes) {
    if(!Buffer.isBuffer(bytes)) throw new Error('bytes is not a buffer');
    this.bytes = bytes;
    this.index = 0;
  }
  checkEOS(length) {
    if(this.index + length > this.bytes.length) return new Error('end of stream reached');
    return null;
  }
  readByte() {
    const e = this.checkEOS(1);
    if(e) return e;

    return this.bytes[this.index++]
  }
  readIntN(n, littleEndian) {
    const e = this.checkEOS(n);
    if(e) return e;

    let returnValue = 0;
    for(let i = 0 ; i < n ; i++) {
      let curShift = i;
      if(!littleEndian) curShift = n - 1 - i;

      returnValue |= this.bytes[this.index + i] << (curShift * 8)
    }

    this.index += n;
    return returnValue;
  }
// missing in whatsapp-web-reveng => using readByte
  readInt8(littleEndian=false) {
    return this.readIntN(1, littleEndian);
  }
  readInt16(littleEndian=false) {
    return this.readIntN(2, littleEndian);
  }
  readInt20(littleEndian=false) {
    const e = this.checkEOS(3);
    if(e) return e;

    const returnValue = ((this.bytes[this.index] & 15) << 16) + (this.bytes[this.index + 1] << 8) + this.bytes[this.index + 2];
    this.index += 3;

    return returnValue;
  }
  readInt32(littleEndian=false) {
    return this.readIntN(4, littleEndian);
  }
  readPacked8(tag) {
    const startByte = this.readByte()
    if(startByte instanceof Error) return startByte;

    let returnValue = '';

    for(let i = 0 ; i < (startByte&127) ; i++) {
      const currByte = this.readByte();
      if(currByte instanceof Error) return currByte

      const lower = this.unpackByte(tag, (currByte & 0xF0) >> 4)
      if(lower instanceof Error) return lower;
      const upper = this.unpackByte(tag, currByte & 0x0F)
      if(upper instanceof Error) return upper;

      returnValue += lower + upper;
    }

    if((startByte >> 7) !== 0) {
      returnValue = returnValue.substr(0, returnValue.length - 1);
    }

    return returnValue;
  }
  unpackByte(tag, value) {
    if(tag === BinaryDecoder.token.NIBBLE_8) {
      return this.unpackNibble(value);
    } else if(tag === BinaryDecoder.token.HEX_8) {
      return this.unpackHex(value);
    }
    return new Error(`unpackByte with the unknown tag ${tag}`);
  }
  unpackNibble(value) {
    if(value >= 0 && value <= 9) return String(value);
    else if(value === 10) return '-';
    else if(value === 11) return '.';
    else if(value === 15) return '\0';
    return new Error(`unpackNibble with value ${value}`);
  }
  unpackHex(value) {
    if(value < 0 || value > 15) return new Error(`unpackHex with value ${value}`);
    else if(value < 10) return `0${String(value)}`;
    return `A${String(value - 10)}`;
  }
  readListSize(tag) {
    if(tag === BinaryDecoder.token.LIST_EMPTY) return 0;
    else if(tag === BinaryDecoder.token.LIST_8) return this.readInt8();
    else if(tag === BinaryDecoder.token.LIST_16) return this.readInt16();
    return new Error(`readListSize with unknown tag ${tag} at position ${this.index}`);
  }
// BinaryDecoder.token.SingleByteTokens.length instead of 235 in go-whatsapp
  readString(tag) {
    if(tag >= 3 && tag <= 235) {
      let tok = BinaryDecoder.token.GetSingleToken(tag);
      if(tok instanceof Error) return tok;

      if(tok === 's.whatsapp.net') tok = 'c.us'

      return tok;
    } else if([BinaryDecoder.token.DICTIONARY_0, BinaryDecoder.token.DICTIONARY_1, BinaryDecoder.token.DICTIONARY_2, BinaryDecoder.token.DICTIONARY_3].includes(tag)) {
      const i = this.readInt8(false);
      if(i instanceof Error) return i;

      return BinaryDecoder.token.GetDoubleToken(tag - BinaryDecoder.token.DICTIONARY_0, i);
    } else if(tag === BinaryDecoder.token.LIST_EMPTY) {
      return null;
    } else if(tag === BinaryDecoder.token.BINARY_8) {
      const length = this.readInt8(false);
      if(length instanceof Error) return length;

      return this.readStringFromChars(length);
    } else if(tag === BinaryDecoder.token.BINARY_20) {
      const length = this.readInt20(false);
      if(length instanceof Error) return length;

      return this.readStringFromChars(length);
    } else if(tag === BinaryDecoder.token.BINARY_32) {
      const length = this.readInt32(false);
      if(length instanceof Error) return length;

      return this.readStringFromChars(length);
    } else if(tag === BinaryDecoder.token.JID_PAIR) {
      let b = this.readByte();
      if(b instanceof Error) return b;
      const i = this.readString(b);
      if(i instanceof Error) return i;

      b = this.readByte();
      if(b instanceof Error) return b;
      const j = this.readString(b);
      if(j instanceof Error) return j;

      if(!i || !j) {
        return new Error(`invalid jid pair: ${i} - ${j}`);
      }
      return `${i}@${j}`;
    } else if(tag === BinaryDecoder.token.NIBBLE_8 || tag === BinaryDecoder.token.HEX_8) {
      return this.readPacked8(tag);
    }
    return new Error(`invalid string with tag ${tag}`);
  }
// no String.fromCharCode in whatsapp-web-reveng
  readStringFromChars(length) {
    const e = this.checkEOS(length);
    if(e) return e;

    const returnValue = this.bytes.slice(this.index, this.index + length);
    this.index += length;

    return String(returnValue);
  }
  readAttributes(n) {
    if(n === 0) return null;
    const returnValue = new UTIL.Collection();

    for(let i = 0 ; i < n ; i++) {
      let idx = this.readInt8(false);
      if(idx instanceof Error) return idx;
      const index = this.readString(idx);
      if(index instanceof Error) return index;

      idx = this.readInt8(false);
      if(idx instanceof Error) return idx;
      const value = this.readString(idx);
      if(value instanceof Error) return value;

      returnValue.set(index, value);
    }

    return returnValue;
  }
  readList(tag) {
    const size = this.readListSize(tag);
    if(size instanceof Error) return size;

    const returnValue = []
    for(let i = 0 ; i < size ; i++) {
      const n = this.readNode();
      if(n instanceof Error) return n;
      returnValue[i] = n;
    }
    return returnValue;
  }
  readNode() {
    const returnValue = new Node();

    const size = this.readInt8(false);
    if(size instanceof Error) return size;
    const listSize = this.readListSize(size);
    if(listSize instanceof Error) return listSize;

    const descrTag = this.readInt8(false);
    if(descrTag instanceof Error) return descrTag;
    if(descrTag === BinaryDecoder.token.STREAM_END) return new Error('unexpected stream end');

    returnValue.Description = this.readString(descrTag);
    if(returnValue.Description instanceof Error) return returnValue.Description;

    if(listSize === 0 || !returnValue.Description) return new Error('invalid Node');

    returnValue.Attributes = this.readAttributes((listSize - 1) >> 1);
    if(returnValue.Attributes instanceof Error) return returnValue.Attributes;

    if(listSize % 2 === 1) return returnValue;


    const tag = this.readInt8(false);
    if(tag instanceof Error) return tag;

    if([BinaryDecoder.token.LIST_EMPTY, BinaryDecoder.token.LIST_8, BinaryDecoder.token.LIST_16].includes(tag)) {
      returnValue.Content = this.readList(tag);
    } else if(tag === BinaryDecoder.token.BINARY_8) {
      const size = this.readInt8(false);
      if(size instanceof Error) return size;

      returnValue.Content = this.readBytes(size);
    } else if(tag === BinaryDecoder.token.BINARY_20) {
      const size = this.readInt20(false);
      if(size instanceof Error) return size;

      returnValue.Content = this.readBytes(size);
    } else if(tag === BinaryDecoder.token.BINARY_32) {
      const size = this.readInt32(false);
      if(size instanceof Error) return size;

      returnValue.Content = this.readBytes(size);
    } else {
      returnValue.Content = this.readString(tag);
    }
    if(returnValue.Content instanceof Error) return returnValue.Content;

    return returnValue;
  }
// string used as return value in whatsapp-web-reveng
  readBytes(n) {
    const returnValue = Buffer.alloc(n);

    for(let i = 0 ; i < n ; i++) {
      const b = this.readByte();
      if(b instanceof Error) return b;
      returnValue[i] = b;
    }

    return returnValue;
  }
}
class Node {
  constructor() {
    this.Description = null;
    this.Attributes = null;
    this.Content = null;
  }
}
BinaryDecoder.token = {
  GetDoubleToken: (idx1, idx2) => {
    const n = 256 * idx1 + idx2;
    if (n < 0 || n >= BinaryDecoder.token.DoubleByteTokens.length) return new Error(`index out of double byte token bounds ${n}`);
    return BinaryDecoder.token.DoubleByteTokens[n];
  },
  GetSingleToken: (i) => {
    if(i < 3 || i >= BinaryDecoder.token.SingleByteTokens.length) return new Error(`index out of single byte token bounds ${i}`);
    return BinaryDecoder.token.SingleByteTokens[i];
  },
// not in use
  IndexOfSingleByteToken: (token) => {
    return BinaryDecoder.tokens.SingleByteTokens.indexOf(token);
  },
  TokenFromIndex: (token) => {
    for(const key in BinaryDecoder.token) {
      if(BinaryDecoder.token[key] === token) return key;
    }
    return null;
  },

  SingleByteTokens: [
    null, null, null, '200', '400', '404', '500', '501', '502', 'action', // 0 - 9
    'add', 'after', 'archive', 'author', 'available', 'battery', 'before', 'body', 'broadcast', 'chat', // 10 - 19
    'clear', 'code', 'composing', 'contacts', 'count', 'create', 'debug', 'delete', 'demote', 'duplicate', // 20 - 29
    'encoding', 'error', 'false', 'filehash', 'from', 'g.us', 'group', 'groups_v2', 'height', 'id', // 30 - 39
    'image', 'in', 'index', 'invis', 'item', 'jid', 'kind', 'last', 'leave', 'live', // 40 - 49
    'log', 'media', 'message', 'mimetype', 'missing', 'modify', 'name', 'notification', 'notify', 'out', // 50 - 59
    'owner', 'participant', 'paused', 'picture', 'played', 'presence', 'preview', 'promote', 'query', 'raw', // 60 - 69
    'read', 'receipt', 'received', 'recipient', 'recording', 'relay', 'remove', 'response', 'resume', 'retry', // 70 - 79
    's.whatsapp.net', 'seconds', 'set', 'size', 'status', 'subject', 'subscribe', 't', 'text', 'to', // 80 - 89
    'true', 'type', 'unarchive', 'unavailable', 'url', 'user', 'value', 'web', 'width', 'mute', // 90 - 99
    'read_only', 'admin', 'creator', 'short', 'update', 'powersave', 'checksum', 'epoch', 'block', 'previous', // 100 - 109
    '409', 'replaced', 'reason', 'spam', 'modify_tag', 'message_info', 'delivery', 'emoji', 'title', 'description', // 110 - 119
    'canonical-url', 'matched-text', 'star', 'unstar', 'media_key', 'filename', 'identity', 'unread', 'page', 'page_count', // 120 - 129
    'search', 'media_message', 'security', 'call_log', 'profile', 'ciphertext', 'invite', 'gif', 'vcard', 'frequent', // 130 - 139
    'privacy', 'blacklist', 'whitelist', 'verify', 'location', 'document', 'elapsed', 'revoke_invite', 'expiration', 'unsubscribe', // 140 - 149
    'disable', 'vname', 'old_jid', 'new_jid', 'announcement', 'locked', 'prop', 'label', 'color', 'call', // 150 - 159
    'offer', 'call-id' // 160 - 161
  ],
  DoubleByteTokens: [],

  LIST_EMPTY: 0,
  STREAM_END: 2,
  DICTIONARY_0: 236,
  DICTIONARY_1: 237,
  DICTIONARY_2: 238,
  DICTIONARY_3: 239,
  LIST_8: 248,
  LIST_16: 249,
  JID_PAIR: 250,
  HEX_8: 251,
  BINARY_8: 252,
  BINARY_20: 253,
  BINARY_32: 254,
  NIBBLE_8: 255,

  PACKED_MAX: 254,
  SINGLE_BYTE_MAX: 256,
}

module.exports = data => {
  return new BinaryDecoder(data).readNode();
}
