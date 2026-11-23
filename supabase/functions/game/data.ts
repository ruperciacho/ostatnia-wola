// Scenariusz „Ostatnia wola”: postacie, cechy, pokoje, role, NPC.

export type Category = 'kolor' | 'dodatek' | 'zapach';

export interface AttrValue {
  id: string;
  label: string;
  /** Zdanie poszlaki publicznej (rano na TV). */
  clue: string;
  /** Co widział świadek. */
  seen: string;
  /** Fragment negatywny: „Sprawca …”. */
  not: string;
}

export const CATEGORIES: Category[] = ['kolor', 'dodatek', 'zapach'];

export const CATEGORY_LABEL: Record<Category, string> = {
  kolor: 'Kolor',
  dodatek: 'Dodatek',
  zapach: 'Zapach',
};

export const ATTRS: Record<Category, AttrValue[]> = {
  kolor: [
    { id: 'bordo', label: 'bordo', clue: 'Na miejscu zbrodni zostały nitki w kolorze bordo.', seen: 'ubranie w kolorze bordo', not: 'nie nosi koloru bordo' },
    { id: 'zielen', label: 'butelkowa zieleń', clue: 'Na miejscu zbrodni zostały nitki w kolorze butelkowej zieleni.', seen: 'ubranie w kolorze butelkowej zieleni', not: 'nie nosi butelkowej zieleni' },
    { id: 'granat', label: 'granat', clue: 'Na miejscu zbrodni zostały granatowe nitki.', seen: 'granatowe ubranie', not: 'nie nosi granatu' },
    { id: 'musztard', label: 'musztardowy', clue: 'Na miejscu zbrodni zostały musztardowe nitki.', seen: 'musztardowe ubranie', not: 'nie nosi musztardowego koloru' },
  ],
  dodatek: [
    { id: 'kapelusz', label: 'kapelusz', clue: 'Na podłodze leżało pióro od kapelusza.', seen: 'kapelusz', not: 'nie nosi kapelusza' },
    { id: 'okulary', label: 'okulary', clue: 'Na podłodze leżało szkiełko od okularów.', seen: 'błysk okularów', not: 'nie nosi okularów' },
    { id: 'sygnet', label: 'sygnet', clue: 'Na klamce został odcisk sygnetu.', seen: 'sygnet na palcu', not: 'nie nosi sygnetu' },
    { id: 'szalik', label: 'szalik', clue: 'Na gwoździu przy drzwiach wisiała nitka z szalika.', seen: 'powiewający szalik', not: 'nie nosi szalika' },
  ],
  zapach: [
    { id: 'naftalina', label: 'naftalina', clue: 'W powietrzu unosił się zapach naftaliny.', seen: 'zapach naftaliny', not: 'nie pachnie naftaliną' },
    { id: 'cygara', label: 'cygara', clue: 'W powietrzu unosił się zapach cygar.', seen: 'zapach cygar', not: 'nie pachnie cygarami' },
    { id: 'lawenda', label: 'lawenda', clue: 'W powietrzu unosił się zapach lawendy.', seen: 'zapach lawendy', not: 'nie pachnie lawendą' },
    { id: 'czosnek', label: 'czosnek', clue: 'W powietrzu unosił się zapach czosnku.', seen: 'zapach czosnku', not: 'nie pachnie czosnkiem' },
  ],
};

export interface Character {
  id: string;
  name: string;
  who: string;
  kolor: string;
  dodatek: string;
  zapach: string;
  secret: string;
}

// Każda wartość cechy występuje u 3 postaci, a każda trójka cech jest inna.
export const CHARACTERS: Character[] = [
  { id: 'grazyna', name: 'Ciotka Grażyna', who: 'siostra Henryka, organizuje wszystkie rodzinne pogrzeby', kolor: 'bordo', dodatek: 'kapelusz', zapach: 'naftalina', secret: 'Zamówiłaś stypę na 120 osób. Na dziś.' },
  { id: 'seweryn', name: 'Kuzyn Seweryn', who: '„inwestor”', kolor: 'zielen', dodatek: 'okulary', zapach: 'cygara', secret: 'Przegrałeś 200 tys. pożyczone od Henryka na krypto z kaczką w logo.' },
  { id: 'bozena', name: 'Synowa Bożena', who: 'żona najstarszego syna', kolor: 'granat', dodatek: 'sygnet', zapach: 'lawenda', secret: 'Sprzedajesz rodowe srebra w internecie i podmieniasz je na plastik.' },
  { id: 'zenon', name: 'Ogrodnik Zenon', who: 'pracuje we dworze od 40 lat', kolor: 'musztard', dodatek: 'szalik', zapach: 'czosnek', secret: 'Pod różami zakopałeś trzy poprzednie testamenty.' },
  { id: 'halinka', name: 'Pielęgniarka Halinka', who: 'opiekunka Henryka', kolor: 'bordo', dodatek: 'okulary', zapach: 'lawenda', secret: 'Od roku jesteś potajemnie żoną Henryka.' },
  { id: 'dzastin', name: 'Wnuk Dżastin', who: 'influencer, 312 obserwujących', kolor: 'zielen', dodatek: 'sygnet', zapach: 'czosnek', secret: 'Transmitowałeś kolację na żywo, łącznie ze śmiercią dziadka.' },
  { id: 'kazimierz', name: 'Major Kazimierz', who: '„emerytowany wojskowy”', kolor: 'granat', dodatek: 'szalik', zapach: 'naftalina', secret: 'Nigdy nie byłeś w wojsku, mundur kupiłeś w internecie.' },
  { id: 'mirek', name: 'Szwagier Mirek', who: '„złota rączka”', kolor: 'musztard', dodatek: 'kapelusz', zapach: 'cygara', secret: 'Henryk przyłapał cię na podrabianiu jego podpisu.' },
  { id: 'klaudia', name: 'Pasierbica Klaudia', who: 'nosi futro po babci', kolor: 'bordo', dodatek: 'sygnet', zapach: 'naftalina', secret: 'Nie jesteś pasierbicą i nikt nie wie, kim jesteś.' },
  { id: 'nikola', name: 'Prawnuczka Nikola', who: 'robi podcast true crime', kolor: 'zielen', dodatek: 'szalik', zapach: 'cygara', secret: 'Twojemu podcastowi brakuje drugiego trupa do odcinka.' },
  { id: 'jadzia', name: 'Sąsiadka Jadzia', who: 'zza płotu, zawsze wszystko widzi', kolor: 'granat', dodatek: 'kapelusz', zapach: 'lawenda', secret: 'Od 30 lat podkradasz Henrykowi prąd.' },
  { id: 'ambrozy', name: 'Profesor Ambroży', who: 'historyk sztuki, wycenia pamiątki', kolor: 'musztard', dodatek: 'okulary', zapach: 'czosnek', secret: 'Połowa rodowych pamiątek to podróbki twojej roboty.' },
];

export const SERVANTS: { id: string; name: string }[] = [
  { id: 'bronia', name: 'Kucharka Bronia' },
  { id: 'waldek', name: 'Szofer Waldek' },
  { id: 'zosia', name: 'Pokojówka Zosia' },
  { id: 'edek', name: 'Kominiarz Edek' },
  { id: 'tadeusz', name: 'Organista Tadeusz' },
  { id: 'mietek', name: 'Listonosz Mietek' },
];

export interface Room {
  id: string;
  name: string;
  loc: string; // „w Kuchni”
  from: string; // „z Kuchni”
  heirloom: string;
  /** Opisy śmierci (bez krwi); losowany jeden. */
  deaths: string[];
}

export const ROOMS: Room[] = [
  { id: 'biblioteka', name: 'Biblioteka', loc: 'w Bibliotece', from: 'z Biblioteki', heirloom: '„Pan Tadeusz” z dedykacją od Mickiewicza (podobno)', deaths: [
    'Przyczyna zgonu: regał z encyklopedią. Ostatni widziany tom: „Śm–Św”.',
    'Przyczyna zgonu: „Słownik wyrazów obcych”, wydanie pełne, upuszczony z drabiny.',
    'Przyczyna zgonu: zaczytanie się na śmierć. Zakładka tkwi na stronie „Koniec”.',
    'Przyczyna zgonu: książka oddana po terminie. Bibliotekarka z zaświatów nie wybacza.',
    'Przyczyna zgonu: stos nieprzeczytanych prezentów od cioci. Runął.',
    'Przyczyna zgonu: kurz z pierwszego wydania. To kichnięcie było ostatnie.',
    'Przyczyna zgonu: tajne przejście za regałem otworzyło się w złą stronę.',
    'Przyczyna zgonu: lektura testamentu Henryka. Zbyt wiele zer, zbyt mało imion.',
    'Przyczyna zgonu: drabina biblioteczna na kółkach. Pojechała. Sama.',
    'Przyczyna zgonu: „Poradnik długowieczności”, tom pierwszy i jedyny.',
  ] },
  { id: 'kuchnia', name: 'Kuchnia', loc: 'w Kuchni', from: 'z Kuchni', heirloom: 'zeszyt z przepisem na sernik', deaths: [
    'Przyczyna zgonu: garnek rosołu na 40 osób.',
    'Przyczyna zgonu: ostatni kawałek sernika. Ktoś go bardzo pilnował.',
    'Przyczyna zgonu: pierogi babci Wolańskiej. Twarde jak rodzinna tradycja.',
    'Przyczyna zgonu: szybkowar, który od 1974 roku czekał na swoją chwilę.',
    'Przyczyna zgonu: wałek do ciasta, rodzinna pamiątka z charakterem.',
    'Przyczyna zgonu: zamrażarka. Ktoś zamknął drzwi i zgasił światło.',
    'Przyczyna zgonu: „tylko szczypta” przyprawy z tajemniczego słoika bez etykiety.',
    'Przyczyna zgonu: lawina słoików z ogórkami z 1998 roku.',
    'Przyczyna zgonu: galaretka z nóżkami. Patrzyła.',
    'Przyczyna zgonu: wiadro kompotu i bardzo śliska podłoga.',
  ] },
  { id: 'gabinet', name: 'Gabinet', loc: 'w Gabinecie', from: 'z Gabinetu', heirloom: 'złota papierośnica', deaths: [
    'Przyczyna zgonu: lektura księgi rachunkowej Henryka. Śmiertelnie nudna.',
    'Przyczyna zgonu: przycisk do papieru w kształcie popiersia Henryka.',
    'Przyczyna zgonu: fotel obrotowy rozkręcony do prędkości światła.',
    'Przyczyna zgonu: sejf. Otworzył się. Na głowę.',
    'Przyczyna zgonu: drobny druk w umowie z Henrykiem.',
    'Przyczyna zgonu: globus z barkiem. Za dużo świata naraz.',
    'Przyczyna zgonu: wypchany dzik nad kominkiem w końcu się zemścił.',
    'Przyczyna zgonu: maszyna do pisania. Ostatnie słowo: „qwerty”.',
    'Przyczyna zgonu: zszywacz firmy Wolański i Synowie, model „Pancerny”.',
    'Przyczyna zgonu: lawina segregatorów z napisem „Pilne 1987”.',
  ] },
  { id: 'piwnica', name: 'Piwnica', loc: 'w Piwnicy', from: 'z Piwnicy', heirloom: 'wino, rocznik 1921', deaths: [
    'Przyczyna zgonu: świeżo postawiona ścianka za regałem z winem. Jak u Poego.',
    'Przyczyna zgonu: beczka kiszonej kapusty, która ma już własne zdanie.',
    'Przyczyna zgonu: trzynasty stopień schodów. Wszyscy wiedzieli, który.',
    'Przyczyna zgonu: korek od szampana z 1921 roku. Czekał na to sto lat.',
    'Przyczyna zgonu: zatrzaśnięte drzwi i świeczka, która zgasła pierwsza.',
    'Przyczyna zgonu: słoik konfitur, który wybuchł z dumy.',
    'Przyczyna zgonu: piec, którego nikt nie umiał obsłużyć od czasów wojny.',
    'Przyczyna zgonu: szczur Bolek, który był tu pierwszy.',
    'Przyczyna zgonu: worek ziemniaków z najwyższej półki.',
    'Przyczyna zgonu: tajne przejście do lochu. Bilet był w jedną stronę.',
  ] },
  { id: 'oranzeria', name: 'Oranżeria', loc: 'w Oranżerii', from: 'z Oranżerii', heirloom: 'storczyk wart więcej niż cały dom', deaths: [
    'Przyczyna zgonu: storczyk, który podobno jest wegetarianinem.',
    'Przyczyna zgonu: kaktus „Pieszczoch”, ulubieniec Henryka.',
    'Przyczyna zgonu: donica z palmą, która spadła z półki pod sufitem.',
    'Przyczyna zgonu: grabie. Klasyka gatunku.',
    'Przyczyna zgonu: zraszacz przestawiony na tryb „monsun”.',
    'Przyczyna zgonu: pyłek egzotycznego kwiatu. Kichnięcie stulecia.',
    'Przyczyna zgonu: krasnal ogrodowy o bardzo ciężkim spojrzeniu.',
    'Przyczyna zgonu: szklarnia nagrzana jak sauna i zatrzaśnięte drzwi.',
    'Przyczyna zgonu: winorośl, która w nocy urosła o metr. W złą stronę.',
    'Przyczyna zgonu: nawóz „Super Wzrost” pomylony z cukrem do herbaty.',
  ] },
  { id: 'strych', name: 'Strych', loc: 'na Strychu', from: 'ze Strychu', heirloom: 'portret pradziadka z oczami, które śledzą', deaths: [
    'Przyczyna zgonu: pościg za nietoperzem zakończony za okienkiem.',
    'Przyczyna zgonu: kufer z pamiątkami, który zamknął się od środka.',
    'Przyczyna zgonu: manekin krawiecki, który nagle się poruszył. Serce nie wytrzymało.',
    'Przyczyna zgonu: deska w podłodze, która od lat tylko udawała, że trzyma.',
    'Przyczyna zgonu: konik na biegunach rozpędzony do granic możliwości.',
    'Przyczyna zgonu: gniazdo os, które nie lubi gości.',
    'Przyczyna zgonu: lawina albumów ze zdjęciami z wakacji 1979–1984.',
    'Przyczyna zgonu: portret pradziadka. Spadł. Patrzył do końca.',
    'Przyczyna zgonu: pozytywka grająca w kółko tę samą melodię. Od trzech dni.',
    'Przyczyna zgonu: pułapka na myszy zastawiona przez Henryka w 1962 roku.',
  ] },
];

export type RoleId = 'krewny' | 'detektyw' | 'kamerdyner' | 'lekarz' | 'zabojca' | 'zlodziej' | 'blazen';
export type Faction = 'rodzina' | 'zabojcy' | 'neutralni';

export interface Role {
  id: RoleId;
  name: string;
  faction: Faction;
  does: string;
  wins: string;
}

export const ROLES: Record<RoleId, Role> = {
  krewny: { id: 'krewny', name: 'Krewny', faction: 'rodzina', does: 'Robisz zadania, zbierasz poszlaki i szukasz zabójcy.', wins: 'Wygrywasz, gdy wszyscy zabójcy zostaną złapani.' },
  detektyw: { id: 'detektyw', name: 'Detektyw', faction: 'rodzina', does: 'Z każdego udanego zadania dostajesz dwie poszlaki zamiast jednej.', wins: 'Wygrywasz, gdy wszyscy zabójcy zostaną złapani.' },
  kamerdyner: { id: 'kamerdyner', name: 'Kamerdyner', faction: 'rodzina', does: 'Co noc obserwujesz jeden pokój i widzisz, kto w nim był.', wins: 'Wygrywasz, gdy wszyscy zabójcy zostaną złapani.' },
  lekarz: { id: 'lekarz', name: 'Lekarz rodzinny', faction: 'rodzina', does: 'Co noc chronisz jedną osobę, ale nie tę samą dwie noce z rzędu.', wins: 'Wygrywasz, gdy wszyscy zabójcy zostaną złapani.' },
  zabojca: { id: 'zabojca', name: 'Zabójca', faction: 'zabojcy', does: 'Co noc wybierasz ofiarę. Po udanej mini-grze podrzucasz fałszywy trop na kogoś innego. Kłam i odwracaj uwagę.', wins: 'Wygrywasz, gdy o świcie przynajmniej jeden zabójca jest na wolności.' },
  zlodziej: { id: 'zlodziej', name: 'Złodziej', faction: 'neutralni', does: 'Okradasz pokój, w którym spędzasz noc, jeśli jest tam z tobą najwyżej jedna osoba. Złapany oddaje łupy.', wins: 'Wygrywasz, gdy masz 3 pamiątki i na koniec nie siedzisz w areszcie.' },
  blazen: { id: 'blazen', name: 'Błazen', faction: 'neutralni', does: 'Robisz zadania i zachowujesz się podejrzanie, żeby inni cię oskarżyli.', wins: 'Wygrywasz, gdy choć raz trafisz do aresztu.' },
};

/** Rozkład ról według liczby graczy (bez Lekarza; Lekarz zastępuje Krewnego, gdy śmierć jest włączona). */
export function roleDistribution(n: number, death: boolean): RoleId[] {
  const table: Record<number, [number, number, number, number, number]> = {
    // zabojcy, zlodziej, blazen, detektyw, kamerdyner
    3: [1, 0, 0, 0, 0],
    4: [1, 1, 0, 0, 0],
    5: [1, 0, 0, 1, 0],
    6: [1, 1, 0, 1, 0],
    7: [1, 1, 0, 1, 1],
    8: [2, 1, 0, 1, 1],
    9: [2, 1, 1, 1, 1],
    10: [2, 1, 1, 1, 1],
    11: [2, 1, 1, 1, 1],
    12: [3, 1, 1, 1, 1],
  };
  const row = table[Math.max(3, Math.min(12, n))];
  const roles: RoleId[] = [];
  for (let i = 0; i < row[0]; i++) roles.push('zabojca');
  for (let i = 0; i < row[1]; i++) roles.push('zlodziej');
  for (let i = 0; i < row[2]; i++) roles.push('blazen');
  for (let i = 0; i < row[3]; i++) roles.push('detektyw');
  for (let i = 0; i < row[4]; i++) roles.push('kamerdyner');
  if (death && roles.length < n) roles.push('lekarz');
  while (roles.length < n) roles.push('krewny');
  return roles;
}

export const INTRO: string[] = [
  'Listopad. Burza trwa od trzech godzin, a most do miasteczka właśnie odpłynął. Henryk Wolański, 91 lat, fabrykant guzików i tyran trzech pokoleń, zaprosił całą rodzinę na kolację. Po deserze zasnął twarzą w serniku. Tym razem na zawsze.',
  'Nazywam się Wiesław Pióro, jestem notariuszem rodziny. Testament odczytam o świcie, punktualnie o czwartej. Majątek dzielą ci, którzy wtedy będą siedzieć przy tym stole.',
  'Lekarz mówi, że to serce. Ja mówię, że serniki nie zabijają same. Proszę teraz zajrzeć do telefonów. Dyskretnie.',
];
