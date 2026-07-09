(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.YoiHibi = Object.assign(root.YoiHibi || {}, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_MEDIA_MAPPING = {
    'よい日々': '自社',
    '楽天よい日々': '楽天',
    'Amazon': 'アマゾン',
    'Amazon　FBA': 'アマゾン',
    'Amazon FBA': 'アマゾン',
    'TikTok': 'その他',
    'Creema': 'その他',
    'メルカリ': 'その他',
    '会報誌': 'その他',
  };

  const EXCLUDED_MEDIA = ['倉庫移動', '本社'];

  function mapMediaToChannel(rawName, mappingOverride) {
    const table = Object.assign({}, DEFAULT_MEDIA_MAPPING, mappingOverride || {});
    const name = (rawName == null ? '' : String(rawName)).trim();

    if (EXCLUDED_MEDIA.includes(name)) {
      return { channel: null, mapped: true };
    }
    if (Object.prototype.hasOwnProperty.call(table, name)) {
      return { channel: table[name], mapped: true };
    }
    if (name.startsWith('BtoB')) {
      return { channel: '卸', mapped: true };
    }
    if (name.startsWith('YAHOO')) {
      return { channel: 'yahoo', mapped: true };
    }
    return { channel: 'その他', mapped: false };
  }

  return { mapMediaToChannel, DEFAULT_MEDIA_MAPPING, EXCLUDED_MEDIA };
});
