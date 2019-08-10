exports.Encryption = require('./Encryption.js');
exports.Collection = require('./Collection.js')

let cur_id, cur_time;
/**
 * build a new, unique, time based id
 * @returns {string}
 */
exports.buildID = () => {
  const t = Math.floor(Date.now() / 1000);
  if(t !== cur_time) {
    cur_time = t;
    cur_id = 0;
  }
  return `${cur_time}--${cur_id++}`;
}

Array.prototype.unDoub = function() {
  return this.filter((item, pos) => {
    return this.indexOf(item) === pos;
  });
}
