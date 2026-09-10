import { Platform, SafeAreaView, StatusBar as RNStatusBar, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";

import { SafetyCheckModal } from "./components/SafetyCheckModal";
import { colors } from "./constants/theme";
import { useJourneyMonitor } from "./hooks/useJourneyMonitor";
import { HomeScreen } from "./screens/HomeScreen";
import { JourneyScreen } from "./screens/JourneyScreen";

export default function App() {
  const monitor = useJourneyMonitor();
  const onJourney = monitor.phase === "active";

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      {onJourney ? (
        <JourneyScreen monitor={monitor} />
      ) : (
        <HomeScreen
          starting={monitor.phase === "starting"}
          error={monitor.error}
          onStart={(destination) => void monitor.start(destination)}
          onDismissError={monitor.dismissError}
        />
      )}

      <SafetyCheckModal
        visible={onJourney && monitor.safetyState === "CHECKING"}
        check={monitor.pendingCheck}
        busy={monitor.respondingToCheck}
        onRespond={(response) => void monitor.respond(response)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === "android" ? RNStatusBar.currentHeight ?? 0 : 0,
  },
});
