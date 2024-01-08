import custom from "./webpack.config.js"

module.exports = {
  stories: ["../src/**/stories/*.tsx"],

  webpackFinal: async config => {
    return {
      ...config,
      ...custom(config)
    }
  },

  framework: {
    name: "@storybook/react-webpack5",
    options: {}
  },

  docs: {
    autodocs: false
  }
}
