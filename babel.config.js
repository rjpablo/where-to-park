module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // SDK 54 resolves ESM builds; zustand's uses `import.meta.env`, which is a
          // syntax error in the classic web bundle ("Cannot use 'import.meta' outside a
          // module"). This rewrites import.meta for Metro.
          unstable_transformImportMeta: true,
        },
      ],
    ],
  };
};
