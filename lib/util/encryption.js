const CRYPTO = require('crypto');
const AXLSIGN = require('axlsign');
const HKDF = require('futoin-hkdf');

/**
 * A Class to handle all Encryption, Decryption and key generation
 */
class Cryptography {
  /**
   * @param {string|Buffer} clientID the clientID to use
   * @param {string|Buffer} ecKeysSeed the ecKeys Seed to use
   * @throws invalid type Error
   */
  constructor(clientID, ecKeysSeed) {
    if(Buffer.isBuffer(clientID)) {
      this._clientID = clientID;
    } else if(typeof clientID === 'string' && clientID) {
      this._clientID = Buffer.from(clientID, 'base64');
    } else {
      throw new Error('clientID neither a buffer nor a valid string');
    }

    if(Buffer.isBuffer(ecKeysSeed)) {
      this._ecKeysSeed = ecKeysSeed;
    } else if(typeof ecKeysSeed === 'string' && ecKeysSeed) {
      this._ecKeysSeed = Buffer.from(ecKeysSeed, 'base64');
    } else {
      throw new Error('ecKeysSeed neither a buffer nor a valid string');
    }
    this._ecKeys = AXLSIGN.generateKeyPair(this._ecKeysSeed);
  }

  /**
   * whether the instance is ready to be used for en-/decryption
   * @returns {boolean}
   */
  get usable() {
    return this.encKey && this.macKey;
  }

  /**
   * set the server token
   * @param {string} serverToken
   * @throws invalid type Error
   */
  setServerToken(serverToken) {
    if(typeof serverToken !== 'string' || !serverToken) throw new Error('invalid serverToken: ' + serverToken);
    this._serverToken = serverToken;
  }
  /**
   * get the current server token
   * @returns {?string} serverToken
   */
  getServerToken() {
    return this._serverToken;
  }
  /**
   * set the client token
   * @param {string} clientToken
   * @throws invalid type Error
   */
  setClientToken(clientToken) {
    if(typeof clientToken !== 'string' || !clientToken) throw new Error('invalid clientToken');
    this._clientToken = clientToken;
  }
  /**
   * get the current client token
   * @returns {?string} clientToken
   */
  getClientToken() {
    return this._clientToken;
  }
  /**
   * set the encKey and macKey
   * @param {string} encKey
   * @param {string} macKey
   * @throws invalid type Error
   */
  loadKeys(encKey, macKey) {
    if(typeof encKey !== 'string' || !encKey) throw new Error('invalid encKey');
    if(typeof macKey !== 'string' || !macKey) throw new Error('invalid macKey');
    this.encKey = Buffer.from(encKey, 'base64');
    this.macKey = Buffer.from(macKey, 'base64');
  }
  /**
   * get the current client id
   * @returns {string} clientID
   */
  getClientID() {
    return this._clientID.toString('base64');
  }

  /**
   * builds new encKey and macKey based on the secret received from WhatsApp server
   * @param {string} secret
   */
  buildNewPair(secret) {
    const secretString = Buffer.from(secret, 'base64');
    const secretPublicKey = secretString.slice(0, 32);

    const sharedSecret = AXLSIGN.sharedKey(this._ecKeys.private, secretPublicKey);
    const sharedSecretExpanded = HKDF(sharedSecret, 80);

    const hash = Cryptography.HmacSha256(
      sharedSecretExpanded.slice(32, 64),
      Buffer.concat([secretPublicKey, secretString.slice(64)])
    );
    const hash2 = secretString.slice(32, 64);

    if(!hash.equals(hash2)) throw new Error('key validation is fucked up');

    const keysEncrypted = Buffer.concat([sharedSecretExpanded.slice(64), secretString.slice(64)]);
    const keysDecrypted = Cryptography.AESDecrypt(sharedSecretExpanded.slice(0, 32), keysEncrypted);

    this.encKey = keysDecrypted.slice(0, 32);
    this.macKey = keysDecrypted.slice(32, 64);
  }
  /**
   * get the current sessionData
   * @returns {sessionData} sessionData
   */
  serialize() {
    return {
      EC_KEYS_SEED: this._ecKeysSeed.toString('base64'),
      ENC_KEY: this.encKey.toString('base64'),
      MAC_KEY: this.macKey.toString('base64'),
      SERVER_TOKEN: this._serverToken,
      CLIENT_ID: this._clientID.toString('base64'),
      CLIENT_TOKEN: this._clientToken,
    }
  }

  // TODO: documentation
  AESDecrypt(cipher) {
    const decipher = CRYPTO.createDecipheriv('aes-256-cbc', this.encKey, cipher.slice(0, 16));
    return Buffer.concat([decipher.update(cipher.slice(16)) , decipher.final()]);
  }
  // TODO: documentation
  HmacSha256(data) {
    return CRYPTO.createHmac('sha256', this.macKey).update(data).digest();
  }
}
// TODO: documentation
Cryptography.AESDecrypt = (key, cipher) => {
  const decipher = CRYPTO.createDecipheriv('aes-256-cbc', key, cipher.slice(0, 16));
  return Buffer.concat([decipher.update(cipher.slice(16)) , decipher.final()]);
}
// TODO: documentation
Cryptography.HmacSha256 = (key, data) => {
  return CRYPTO.createHmac('sha256', key).update(data).digest();
}
// TODO: documentation
Cryptography.randomBytes = length => {
  return CRYPTO.randomBytes(length); //.toString('base64');
}
// TODO: documentation
Cryptography.new = () => new Cryptography(
  Cryptography.randomBytes(16),
  Cryptography.randomBytes(32)
);
module.exports = Cryptography;
