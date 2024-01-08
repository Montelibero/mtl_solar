const fs = require("fs")
const path = require("path")

module.exports = async function customizeWebpackConfig({ config }) {
  if (config) {
    config.module.rules.push({
      test: /(^\.d)\.(ts|tsx)$/,
      loader: require.resolve("ts-loader")
    })
    config.output.globalObject = "self"
    config.resolve.alias = {
      ...config.resolve.alias,
      ...createModuleAliases()
    }
    config.resolve.extensions.push("[^.d].ts", "[^.d].tsx")
    config.resolve.fallback = {
      os: require.resolve("os-browserify/browser"),
      https: require.resolve("https-browserify"),
      http: require.resolve("stream-http"),
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify")
    }
  }

  return config
}

function createModuleAliases() {
  const modules = fs.readdirSync(path.join(__dirname, "../src")).filter(filename => filename.match(/^[A-Z][^\.]+/))

  return modules.reduce(
    (aliases, moduleName) => ({ ...aliases, [`~${moduleName}`]: path.join(__dirname, `../src/${moduleName}`) }),
    {}
  )
}
