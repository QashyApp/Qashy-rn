import { ionIconId } from "@/utils/icon-id";

/**
 * The browsable category icon set. Every entry is an Ionicons outline glyph, stored as
 * `ion:<glyph>-outline`. A test asserts each name exists in the bundled glyph map, so a font
 * upgrade that drops one fails CI rather than rendering a question mark.
 */
export type IconTopic =
  | "food"
  | "home"
  | "transport"
  | "shopping"
  | "health"
  | "fun"
  | "money"
  | "work"
  | "travel"
  | "nature"
  | "tech"
  | "people"
  | "other";

export const ICON_TOPICS: readonly { id: IconTopic; label: string }[] = [
  { id: "food", label: "Food" },
  { id: "home", label: "Home" },
  { id: "transport", label: "Transport" },
  { id: "shopping", label: "Shopping" },
  { id: "health", label: "Health" },
  { id: "fun", label: "Fun" },
  { id: "money", label: "Money" },
  { id: "work", label: "Work" },
  { id: "travel", label: "Travel" },
  { id: "nature", label: "Nature" },
  { id: "tech", label: "Tech" },
  { id: "people", label: "People" },
  { id: "other", label: "Other" },
];

const GLYPHS_BY_TOPIC: Record<IconTopic, string> = {
  food: "restaurant cafe beer pint wine pizza fast-food ice-cream fish nutrition egg basket cart storefront flame water leaf flask beaker",
  home: "home bed key lock-closed hammer construct build bulb flashlight color-fill brush cube layers tv desktop thermometer trash trash-bin archive file-tray-full bonfire umbrella rainy flower bandage",
  transport:
    "car car-sport bus subway train boat airplane bicycle walk navigate compass map trail-sign speedometer footsteps location pin rocket flash flame battery-charging",
  shopping:
    "bag bag-handle bag-add bag-check cart basket storefront shirt gift pricetag pricetags ticket receipt barcode diamond glasses watch cut color-wand sparkles star",
  health:
    "heart heart-half medkit medical bandage fitness barbell body pulse thermometer happy sad nutrition water walk accessibility footsteps leaf bed ear eye",
  fun: "game-controller dice musical-note musical-notes film videocam camera image images headset mic tv football basketball baseball tennisball american-football golf bowling-ball balloon sparkles ribbon trophy medal podium happy easel color-palette shapes disc",
  money:
    "cash card wallet receipt calculator trending-up trending-down stats-chart bar-chart pie-chart analytics diamond ticket scale podium business library infinite swap-horizontal swap-vertical repeat refresh pricetag save",
  work: "briefcase business calculator document document-text documents clipboard reader journal book bookmark newspaper mail mail-open send call chatbubbles megaphone calendar calendar-number today alarm time timer stopwatch hourglass print school library telescope easel folder-open server terminal code git-branch construct hammer build id-card",
  travel:
    "airplane boat bus train subway car bicycle earth globe map navigate compass location pin bed trail-sign binoculars camera umbrella sunny moon partly-sunny snow rainy thunderstorm bonfire ticket flag key",
  nature:
    "leaf flower rose paw bug fish sunny moon cloud cloudy cloudy-night partly-sunny rainy snow thunderstorm water flame planet earth telescope bonfire egg trail-sign thermometer prism",
  tech: "laptop desktop phone-portrait phone-landscape tablet-portrait tablet-landscape tv watch headset hardware-chip server wifi bluetooth cellular battery-full battery-charging camera mic videocam game-controller code terminal bug cloud-upload cloud-download qr-code barcode finger-print power print link magnet extension-puzzle",
  people:
    "person people man woman male female male-female body happy sad heart hand-left hand-right thumbs-up thumbs-down chatbubbles mail call person-add id-card finger-print glasses ear eye accessibility shirt gift",
  other:
    "star star-half flag bookmark bookmarks pricetag ribbon trophy medal key lock-open shield shield-checkmark skull nuclear infinite planet apps grid shapes cube albums archive bulb flash sparkles alarm notifications warning help-circle information-circle ellipse square triangle aperture analytics at attach bookmark chatbox clipboard cog color-filter color-wand copy create crop cube eyedrop globe hand-right image link list magnet options paper-plane pencil pulse push radio save scan speedometer stopwatch sync telescope toggle videocam volume-high",
};

export type CatalogIcon = {
  /** The stored icon id, `ion:<glyph>-outline`. */
  id: string;
  /** Ionicons glyph name without the `-outline` suffix. */
  glyph: string;
  /** Human label, derived from the glyph: `ice-cream` → "Ice cream". */
  label: string;
  topics: IconTopic[];
  /** Lower-cased words the search box matches against. */
  keywords: string;
};

/** Search synonyms. Glyph names are Ionicons' vocabulary; people search in theirs. */
const ALIASES: Record<string, string> = {
  restaurant: "dining eat food dinner lunch fork knife",
  cafe: "coffee tea drink latte",
  beer: "bar alcohol drink pub",
  pint: "bar alcohol drink pub",
  wine: "bar alcohol drink glass",
  pizza: "takeaway delivery",
  "fast-food": "burger takeaway junk",
  "ice-cream": "dessert sweets treat",
  nutrition: "fruit apple diet healthy",
  basket: "groceries supermarket market",
  cart: "groceries supermarket shopping trolley",
  storefront: "shop store market retail",
  flame: "gas fuel heating fire",
  flash: "electricity power energy utilities bolt",
  water: "bill utilities drop",
  home: "house rent mortgage",
  bed: "sleep hotel rent bedroom",
  key: "rent keys access",
  bulb: "electricity light idea",
  hammer: "repairs tools diy maintenance",
  construct: "repairs tools maintenance",
  build: "repairs tools maintenance",
  trash: "waste bin garbage",
  "trash-bin": "waste garbage rubbish",
  car: "auto vehicle parking",
  "car-sport": "auto vehicle",
  bus: "transit commute public",
  subway: "metro underground transit commute",
  train: "rail transit commute",
  airplane: "flight flights plane fly",
  boat: "ferry cruise ship sailing",
  bicycle: "bike cycling",
  walk: "walking steps",
  speedometer: "fines tolls driving",
  bag: "shopping purchases",
  "bag-handle": "shopping purchases",
  shirt: "clothes clothing apparel fashion",
  gift: "present gifts birthday donation",
  pricetag: "sale discount label",
  receipt: "bill invoice expenses",
  ticket: "events tickets cinema concert",
  heart: "health love charity favourite",
  medkit: "doctor medicine pharmacy first aid",
  medical: "doctor hospital pharmacy",
  fitness: "gym exercise workout sport",
  barbell: "gym weights workout",
  "game-controller": "games gaming videogames console",
  film: "movies cinema streaming",
  "musical-note": "music spotify concert",
  "musical-notes": "music spotify concert",
  headset: "support gaming audio podcast",
  tv: "television streaming subscriptions",
  videocam: "video streaming camera",
  balloon: "party celebration birthday",
  trophy: "prize win sport award",
  cash: "money salary pay wages income bills",
  card: "credit debit payment refund",
  wallet: "money cash purse",
  "trending-up": "investments growth stocks savings profit",
  "trending-down": "loss decline",
  "stats-chart": "investments report analytics",
  "pie-chart": "budget report",
  library: "bank savings",
  business: "bank office company",
  school: "education study tuition university college course",
  book: "education reading study books",
  briefcase: "job salary freelance business",
  calendar: "schedule date monthly",
  repeat: "subscription recurring monthly",
  "refresh-circle": "subscription recurring",
  paw: "pets dog cat animal vet",
  leaf: "garden plants nature eco savings",
  flower: "garden plants flowers",
  rose: "flowers romance",
  bug: "insects pest",
  umbrella: "insurance weather rain",
  "shield-checkmark": "insurance protection safety",
  shield: "insurance protection safety",
  laptop: "computer tech work electronics",
  desktop: "computer tech electronics",
  "phone-portrait": "mobile phone cell plan",
  call: "phone telephone",
  wifi: "internet broadband",
  cellular: "mobile data phone plan",
  "cloud-upload": "storage subscription backup hosting",
  server: "hosting domain tech",
  "hardware-chip": "electronics computer parts",
  print: "printer office",
  mail: "email post letters",
  send: "transfer message",
  earth: "world travel international",
  globe: "world travel international",
  map: "travel trip directions",
  compass: "travel navigation",
  "trail-sign": "travel hiking directions",
  camera: "photo photography hobby",
  binoculars: "sightseeing travel tourism",
  flag: "goal milestone travel",
  rocket: "startup launch goal",
  planet: "space hobby",
  cut: "haircut barber salon",
  brush: "beauty makeup art paint",
  "color-palette": "art paint hobby design",
  sparkles: "beauty cleaning treats",
  glasses: "optician eyewear reading",
  eye: "optician vision",
  ear: "hearing audiologist",
  body: "wellness spa massage",
  thermometer: "sick fever weather",
  bandage: "injury first aid",
  person: "personal family individual",
  people: "family friends group social",
  man: "male personal",
  woman: "female personal",
  happy: "fun kids mood",
  chatbubbles: "social messaging chat",
  megaphone: "marketing advertising announcement",
  skull: "danger risk",
  hourglass: "time late wait",
  "id-card": "identity passport licence fees",
  "finger-print": "identity security",
  "lock-closed": "security private locked",
  "lock-open": "unlocked",
};

function titleCase(glyph: string) {
  const spaced = glyph.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function build(): CatalogIcon[] {
  const byGlyph = new Map<string, CatalogIcon>();
  for (const topic of Object.keys(GLYPHS_BY_TOPIC) as IconTopic[]) {
    for (const glyph of GLYPHS_BY_TOPIC[topic].split(/\s+/).filter(Boolean)) {
      const existing = byGlyph.get(glyph);
      if (existing) {
        if (!existing.topics.includes(topic)) existing.topics.push(topic);
        continue;
      }
      byGlyph.set(glyph, {
        id: ionIconId(`${glyph}-outline`),
        glyph,
        label: titleCase(glyph),
        topics: [topic],
        keywords:
          `${glyph.replace(/-/g, " ")} ${ALIASES[glyph] ?? ""}`.toLowerCase(),
      });
    }
  }
  return Array.from(byGlyph.values()).sort((a, b) =>
    a.glyph.localeCompare(b.glyph, "en"),
  );
}

export const ICON_CATALOG: readonly CatalogIcon[] = build();

/** Suggested first for each category kind, shown before any topic is chosen. */
export const SUGGESTED_GLYPHS: Record<"expense" | "income", readonly string[]> =
  {
    expense: [
      "cart",
      "restaurant",
      "car",
      "home",
      "heart",
      "sparkles",
      "bag",
      "bus",
      "airplane",
      "gift",
      "school",
      "game-controller",
      "paw",
      "flash",
      "shirt",
      "cafe",
      "medkit",
      "fitness",
      "film",
      "wifi",
      "umbrella",
      "cut",
      "receipt",
      "build",
    ],
    income: [
      "cash",
      "briefcase",
      "trending-up",
      "card",
      "gift",
      "wallet",
      "business",
      "library",
      "ribbon",
      "trophy",
      "star",
      "diamond",
    ],
  };

/** Names for the SF-style ids that categories created before the browser still carry. */
const LEGACY_LABELS: Record<string, string> = {
  cart: "Groceries",
  "fork.knife": "Dining",
  car: "Transport",
  house: "Home",
  heart: "Health",
  sparkles: "Fun",
  bag: "Shopping",
  bus: "Transit",
  airplane: "Travel",
  gift: "Gifts",
  graduationcap: "Education",
  gamecontroller: "Games",
  pawprint: "Pets",
  bolt: "Utilities",
  tshirt: "Clothing",
  banknote: "Pay",
  "plus.circle": "Other income",
  briefcase: "Business",
  "chart.line.uptrend.xyaxis": "Investments",
  creditcard: "Refund",
};

export function legacyIconLabel(id: string): string | undefined {
  return LEGACY_LABELS[id];
}

const BY_ID = new Map(ICON_CATALOG.map((icon) => [icon.id, icon]));

export function findCatalogIcon(id: string): CatalogIcon | undefined {
  return BY_ID.get(id);
}

export function searchCatalog(
  query: string,
  topic: IconTopic | "all",
): CatalogIcon[] {
  const needle = query.trim().toLowerCase();
  const pool =
    topic === "all"
      ? ICON_CATALOG
      : ICON_CATALOG.filter((icon) => icon.topics.includes(topic));
  if (!needle) return [...pool];
  const words = needle.split(/\s+/);
  return pool.filter((icon) =>
    words.every((word) => icon.keywords.includes(word)),
  );
}
