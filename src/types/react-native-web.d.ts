/**
 * react-native-web accepts a `dataSet` prop and renders it as `data-*`
 * attributes, which is how the focus-ring CSS in src/lib/offline/pwa.web.ts
 * finds the elements it needs to style. React Native's own types don't declare
 * it — it has no meaning on native, where these props are simply ignored.
 */

import 'react-native';

type DataSet = Record<string, string | number | boolean | undefined>;

declare module 'react-native' {
  interface ViewProps {
    dataSet?: DataSet;
  }
  interface TextInputProps {
    dataSet?: DataSet;
  }
  interface PressableProps {
    dataSet?: DataSet;
  }
}
