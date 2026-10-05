import type {
  TabGesturesSubscription,
  TabLongPressEvent,
} from "./QashyTabGesturesModule";

const none: {
  addListener(
    eventName: "onTabLongPress",
    listener: (event: TabLongPressEvent) => void,
  ): TabGesturesSubscription;
} | null = null;
export default none;
