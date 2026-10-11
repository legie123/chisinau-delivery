import { Alert } from "react-native";

// Google Play "prominent disclosure" for background location: shown in the normal flow, BEFORE the OS
// permission prompt, saying what is collected, that it is collected while the app is closed or not in
// use, and why; the courier must tap to continue. Declining keeps foreground tracking only.
export const BACKGROUND_DISCLOSURE_TITLE = "Locația ta în fundal";
export const BACKGROUND_DISCLOSURE_TEXT =
  "Dragons Curier colectează locația ta și când aplicația e închisă sau nu o folosești, " +
  "doar cât ai o livrare activă (de la acceptare până la livrare): restaurantul vede unde ești până la ridicare, " +
  "apoi clientul își vede comanda pe hartă. Fără livrare activă nu colectăm locația în fundal. " +
  "Pe ecranul următor alege „Permite întotdeauna”.";

export function askBackgroundDisclosure(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      BACKGROUND_DISCLOSURE_TITLE,
      BACKGROUND_DISCLOSURE_TEXT,
      [
        { text: "Nu acum", style: "cancel", onPress: () => resolve(false) },
        { text: "Continuă", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
