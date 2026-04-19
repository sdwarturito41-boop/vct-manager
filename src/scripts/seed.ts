import "dotenv/config";
import { PrismaClient, Region, Role, PlayerTier } from "../generated/prisma/client";

const prisma = new PrismaClient();

// ── Helpers ──

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcSalary(acs: number, kd: number, adr: number, kast: number): number {
  return Math.round(5000 + acs * 20 + kd * 3000 + adr * 10 + kast * 50);
}

// ── Team & player data ──

const ROLES: Role[] = ["IGL", "Duelist", "Initiator", "Sentinel", "Controller"];

interface TeamSeed {
  name: string;
  tag: string;
  region: Region;
  budget: number;
  prestige: number;
  players: Array<{
    firstName: string;
    lastName: string;
    ign: string;
    nationality: string;
    role: Role;
  }>;
}

const TEAMS: TeamSeed[] = [
  // ─── EMEA ───
  {
    name: "Fnatic", tag: "FNC", region: "EMEA", budget: 2500000, prestige: 95,
    players: [
      { firstName: "Jake", lastName: "Howlett", ign: "Boaster", nationality: "GB", role: "IGL" },
      { firstName: "Nikita", lastName: "Sirmitev", ign: "Derke", nationality: "FI", role: "Duelist" },
      { firstName: "Andrej", lastName: "Perdieus", ign: "Alfajer", nationality: "BE", role: "Initiator" },
      { firstName: "Emir", lastName: "Beder", ign: "Chronicle", nationality: "RU", role: "Sentinel" },
      { firstName: "Tim", lastName: "Blomen", ign: "Hiro", nationality: "NL", role: "Controller" },
    ],
  },
  {
    name: "Team Heretics", tag: "TH", region: "EMEA", budget: 1800000, prestige: 82,
    players: [
      { firstName: "Benjamin", lastName: "Augagneur", ign: "Lowkii", nationality: "FR", role: "IGL" },
      { firstName: "Zygimantas", lastName: "Cizauskas", ign: "nukkye", nationality: "LT", role: "Duelist" },
      { firstName: "Auni", lastName: "Chahade", ign: "RieNs", nationality: "MA", role: "Initiator" },
      { firstName: "Aaro", lastName: "Miettinen", ign: "Aarow", nationality: "FI", role: "Sentinel" },
      { firstName: "Victor", lastName: "Lopes", ign: "Boo", nationality: "PT", role: "Controller" },
    ],
  },
  {
    name: "Team Vitality", tag: "VIT", region: "EMEA", budget: 2000000, prestige: 85,
    players: [
      { firstName: "Santeri", lastName: "Sassi", ign: "BONECOLD", nationality: "FI", role: "IGL" },
      { firstName: "Elias", lastName: "Ollinen", ign: "cNed", nationality: "TR", role: "Duelist" },
      { firstName: "Martin", lastName: "Klancar", ign: "Kick", nationality: "SI", role: "Initiator" },
      { firstName: "Domagoj", lastName: "Fancev", ign: "Mistic", nationality: "HR", role: "Sentinel" },
      { firstName: "Albin", lastName: "Hrustic", ign: "Sayf", nationality: "SE", role: "Controller" },
    ],
  },
  {
    name: "Gentle Mates", tag: "M8", region: "EMEA", budget: 1200000, prestige: 70,
    players: [
      { firstName: "Kaan", lastName: "Guzel", ign: "Muj", nationality: "TR", role: "IGL" },
      { firstName: "Peter", lastName: "Shishmachev", ign: "Pag3", nationality: "BG", role: "Duelist" },
      { firstName: "Lucas", lastName: "Music", ign: "Wailers", nationality: "FR", role: "Initiator" },
      { firstName: "Alexis", lastName: "Music", ign: "YungTao", nationality: "FR", role: "Sentinel" },
      { firstName: "Hugo", lastName: "Morejon", ign: "Logicx", nationality: "FR", role: "Controller" },
    ],
  },
  {
    name: "Karmine Corp", tag: "KC", region: "EMEA", budget: 1500000, prestige: 75,
    players: [
      { firstName: "Berkant", lastName: "Cakir", ign: "xms", nationality: "TR", role: "IGL" },
      { firstName: "Adil", lastName: "Benrlitom", ign: "ScreaM", nationality: "BE", role: "Duelist" },
      { firstName: "Lukas", lastName: "Norstrom", ign: "Shao", nationality: "SE", role: "Initiator" },
      { firstName: "Ivan", lastName: "Lebedev", ign: "N4rrate", nationality: "RU", role: "Sentinel" },
      { firstName: "Milan", lastName: "Klostovic", ign: "Mlyn", nationality: "CZ", role: "Controller" },
    ],
  },
  {
    name: "NAVI", tag: "NAVI", region: "EMEA", budget: 2200000, prestige: 88,
    players: [
      { firstName: "Ardis", lastName: "Svarenieks", ign: "ardiis", nationality: "LV", role: "IGL" },
      { firstName: "Mehmet", lastName: "Ipek", ign: "cNed", nationality: "TR", role: "Duelist" },
      { firstName: "Kamil", lastName: "Graniczka", ign: "Enzo", nationality: "PL", role: "Initiator" },
      { firstName: "Igor", lastName: "Danyliuk", ign: "Redgar", nationality: "UA", role: "Sentinel" },
      { firstName: "Dmytro", lastName: "Hladkykh", ign: "JEEMZZ", nationality: "UA", role: "Controller" },
    ],
  },
  {
    name: "BBL Esports", tag: "BBL", region: "EMEA", budget: 1000000, prestige: 65,
    players: [
      { firstName: "Mehmet", lastName: "Yagiz", ign: "SouhcNi", nationality: "TR", role: "IGL" },
      { firstName: "Dogu", lastName: "Ozbek", ign: "QutionerX", nationality: "TR", role: "Duelist" },
      { firstName: "Can", lastName: "Demir", ign: "Turko", nationality: "TR", role: "Initiator" },
      { firstName: "Osman", lastName: "Unal", ign: "AsLanM4shadoW", nationality: "TR", role: "Sentinel" },
      { firstName: "Efe", lastName: "Yilmaz", ign: "Elite", nationality: "TR", role: "Controller" },
    ],
  },
  {
    name: "FUT Esports", tag: "FUT", region: "EMEA", budget: 900000, prestige: 60,
    players: [
      { firstName: "Burak", lastName: "Yigit", ign: "MrFaliN", nationality: "TR", role: "IGL" },
      { firstName: "Huseyin", lastName: "Karaboga", ign: "Mojj", nationality: "TR", role: "Duelist" },
      { firstName: "Arda", lastName: "Koc", ign: "Muj", nationality: "TR", role: "Initiator" },
      { firstName: "Ismail", lastName: "Celik", ign: "CadiaN", nationality: "TR", role: "Sentinel" },
      { firstName: "Ali", lastName: "Dogan", ign: "Vroom", nationality: "TR", role: "Controller" },
    ],
  },
  {
    name: "KOI", tag: "KOI", region: "EMEA", budget: 1100000, prestige: 68,
    players: [
      { firstName: "Antonio", lastName: "Frias", ign: "starxo", nationality: "ES", role: "IGL" },
      { firstName: "Raul", lastName: "Garcia", ign: "koldamenta", nationality: "ES", role: "Duelist" },
      { firstName: "Marc", lastName: "Fernandez", ign: "Sheydos", nationality: "ES", role: "Initiator" },
      { firstName: "Jose", lastName: "Martinez", ign: "Wolfen", nationality: "ES", role: "Sentinel" },
      { firstName: "Carlos", lastName: "Ruiz", ign: "Grsjl", nationality: "ES", role: "Controller" },
    ],
  },
  {
    name: "Team Liquid", tag: "TL", region: "EMEA", budget: 2300000, prestige: 90,
    players: [
      { firstName: "Elias", lastName: "Joncas", ign: "Jamppi", nationality: "FI", role: "IGL" },
      { firstName: "Adil", lastName: "Benrlitom", ign: "nAts", nationality: "RU", role: "Duelist" },
      { firstName: "Dmitry", lastName: "Shmakov", ign: "dimasick", nationality: "LV", role: "Initiator" },
      { firstName: "Igor", lastName: "Rykhtorov", ign: "Redgar", nationality: "UA", role: "Sentinel" },
      { firstName: "Saif", lastName: "Jibraeel", ign: "Sayf", nationality: "SE", role: "Controller" },
    ],
  },
  {
    name: "Apeks", tag: "APK", region: "EMEA", budget: 800000, prestige: 55,
    players: [
      { firstName: "Nikolaj", lastName: "Jensen", ign: "Keiko", nationality: "DK", role: "IGL" },
      { firstName: "Tobias", lastName: "Hansen", ign: "Shadow", nationality: "NO", role: "Duelist" },
      { firstName: "Axel", lastName: "Lindqvist", ign: "Frosty", nationality: "SE", role: "Initiator" },
      { firstName: "Olav", lastName: "Berge", ign: "Odin", nationality: "NO", role: "Sentinel" },
      { firstName: "Erik", lastName: "Svensson", ign: "Nordic", nationality: "SE", role: "Controller" },
    ],
  },
  {
    name: "Giants Gaming", tag: "GIA", region: "EMEA", budget: 850000, prestige: 58,
    players: [
      { firstName: "Pablo", lastName: "Gonzalez", ign: "hoody", nationality: "ES", role: "IGL" },
      { firstName: "Diego", lastName: "Lopez", ign: "Fit1nho", nationality: "ES", role: "Duelist" },
      { firstName: "Alejandro", lastName: "Perez", ign: "Cloud", nationality: "ES", role: "Initiator" },
      { firstName: "Adrian", lastName: "Santos", ign: "Genghsta", nationality: "ES", role: "Sentinel" },
      { firstName: "Fernando", lastName: "Diaz", ign: "Wippie", nationality: "ES", role: "Controller" },
    ],
  },

  // ─── Americas ───
  {
    name: "Sentinels", tag: "SEN", region: "Americas", budget: 3000000, prestige: 95,
    players: [
      { firstName: "Tyson", lastName: "Ngo", ign: "TenZ", nationality: "CA", role: "Duelist" },
      { firstName: "Michael", lastName: "Grzesiek", ign: "Shroud", nationality: "CA", role: "IGL" },
      { firstName: "Bryan", lastName: "Woo", ign: "pANcada", nationality: "BR", role: "Controller" },
      { firstName: "Zachary", lastName: "Lombardo", ign: "zekken", nationality: "US", role: "Initiator" },
      { firstName: "Gustavo", lastName: "Rossi", ign: "Sacy", nationality: "BR", role: "Sentinel" },
    ],
  },
  {
    name: "Cloud9", tag: "C9", region: "Americas", budget: 2500000, prestige: 88,
    players: [
      { firstName: "Anthony", lastName: "Malaspina", ign: "vanity", nationality: "CA", role: "IGL" },
      { firstName: "Jordan", lastName: "Montemurro", ign: "Zellsis", nationality: "US", role: "Duelist" },
      { firstName: "Nathan", lastName: "Ononaiwu", ign: "leaf", nationality: "CA", role: "Initiator" },
      { firstName: "Erick", lastName: "Santos", ign: "Xeppaa", nationality: "US", role: "Sentinel" },
      { firstName: "Mateo", lastName: "Duran", ign: "Witz", nationality: "AR", role: "Controller" },
    ],
  },
  {
    name: "100 Thieves", tag: "100T", region: "Americas", budget: 2200000, prestige: 85,
    players: [
      { firstName: "Peter", lastName: "Doung", ign: "Asuna", nationality: "US", role: "Duelist" },
      { firstName: "Sean", lastName: "Bezerra", ign: "bang", nationality: "US", role: "IGL" },
      { firstName: "Brenden", lastName: "Rhine", ign: "stellar", nationality: "US", role: "Initiator" },
      { firstName: "Matthew", lastName: "Paez", ign: "Cryocells", nationality: "US", role: "Sentinel" },
      { firstName: "Adam", lastName: "Kaplan", ign: "ec1s", nationality: "US", role: "Controller" },
    ],
  },
  {
    name: "NRG Esports", tag: "NRG", region: "Americas", budget: 1800000, prestige: 80,
    players: [
      { firstName: "Sam", lastName: "Oh", ign: "s0m", nationality: "US", role: "IGL" },
      { firstName: "Austin", lastName: "Roberts", ign: "crashies", nationality: "US", role: "Initiator" },
      { firstName: "Victor", lastName: "Wong", ign: "Victor", nationality: "US", role: "Duelist" },
      { firstName: "Pujan", lastName: "Mehta", ign: "FNS", nationality: "CA", role: "Sentinel" },
      { firstName: "Daniel", lastName: "Kim", ign: "Ethan", nationality: "US", role: "Controller" },
    ],
  },
  {
    name: "Evil Geniuses", tag: "EG", region: "Americas", budget: 2000000, prestige: 82,
    players: [
      { firstName: "Jaccob", lastName: "Slavik", ign: "yay", nationality: "US", role: "Duelist" },
      { firstName: "Corbin", lastName: "Lee", ign: "C0M", nationality: "US", role: "IGL" },
      { firstName: "Jeffrey", lastName: "Tsang", ign: "Reformed", nationality: "CA", role: "Initiator" },
      { firstName: "Kelden", lastName: "Pruett", ign: "Boostio", nationality: "US", role: "Sentinel" },
      { firstName: "Alexander", lastName: "Vidal", ign: "SugarZ3ro", nationality: "US", role: "Controller" },
    ],
  },
  {
    name: "LOUD", tag: "LOUD", region: "Americas", budget: 1500000, prestige: 90,
    players: [
      { firstName: "Erick", lastName: "Santos", ign: "aspas", nationality: "BR", role: "Duelist" },
      { firstName: "Felipe", lastName: "Basso", ign: "Less", nationality: "BR", role: "IGL" },
      { firstName: "Bryan", lastName: "Franco", ign: "tuyz", nationality: "BR", role: "Initiator" },
      { firstName: "Matias", lastName: "Delipetro", ign: "saadhak", nationality: "AR", role: "Sentinel" },
      { firstName: "Guilherme", lastName: "Kalmer", ign: "cauanzin", nationality: "BR", role: "Controller" },
    ],
  },
  {
    name: "FURIA", tag: "FUR", region: "Americas", budget: 1200000, prestige: 75,
    players: [
      { firstName: "Khalil", lastName: "Schmidt", ign: "Khalil", nationality: "BR", role: "Duelist" },
      { firstName: "Andre", lastName: "Perini", ign: "Quick", nationality: "BR", role: "IGL" },
      { firstName: "Douglas", lastName: "Damasceno", ign: "dgzin", nationality: "BR", role: "Initiator" },
      { firstName: "Caio", lastName: "Martins", ign: "Nozwerr", nationality: "BR", role: "Sentinel" },
      { firstName: "Gabriel", lastName: "Martins", ign: "Mazin", nationality: "BR", role: "Controller" },
    ],
  },
  {
    name: "MIBR", tag: "MIBR", region: "Americas", budget: 1100000, prestige: 70,
    players: [
      { firstName: "Leonardo", lastName: "Souza", ign: "Leo", nationality: "BR", role: "IGL" },
      { firstName: "Rafael", lastName: "Costa", ign: "Raafa", nationality: "BR", role: "Duelist" },
      { firstName: "Lucas", lastName: "Almeida", ign: "artzin", nationality: "BR", role: "Initiator" },
      { firstName: "Gustavo", lastName: "Silva", ign: "Gust", nationality: "BR", role: "Sentinel" },
      { firstName: "Pedro", lastName: "Lima", ign: "Pedrito", nationality: "BR", role: "Controller" },
    ],
  },
  {
    name: "Leviatán", tag: "LEV", region: "Americas", budget: 1000000, prestige: 72,
    players: [
      { firstName: "Roberto", lastName: "Puentes", ign: "Mazino", nationality: "CL", role: "Duelist" },
      { firstName: "Marco", lastName: "Elg", ign: "Melser", nationality: "CL", role: "IGL" },
      { firstName: "Vicente", lastName: "Lara", ign: "Tacolilla", nationality: "CL", role: "Initiator" },
      { firstName: "Sebastian", lastName: "Perez", ign: "Shyy", nationality: "CL", role: "Sentinel" },
      { firstName: "Ignacio", lastName: "Cabrera", ign: "Adverso", nationality: "CL", role: "Controller" },
    ],
  },
  {
    name: "KRÜ Esports", tag: "KRU", region: "Americas", budget: 900000, prestige: 65,
    players: [
      { firstName: "Juan", lastName: "Cuevas", ign: "NagZ", nationality: "CL", role: "Duelist" },
      { firstName: "Angelo", lastName: "Mori", ign: "keznit", nationality: "CL", role: "IGL" },
      { firstName: "Nicolas", lastName: "Riveros", ign: "Klaus", nationality: "CL", role: "Initiator" },
      { firstName: "Matias", lastName: "Flores", ign: "Axel", nationality: "AR", role: "Sentinel" },
      { firstName: "Santiago", lastName: "Lopez", ign: "Daveeys", nationality: "AR", role: "Controller" },
    ],
  },
  {
    name: "G2 Esports", tag: "G2", region: "Americas", budget: 2400000, prestige: 92,
    players: [
      { firstName: "Shahzeb", lastName: "Khan", ign: "ShahZaM", nationality: "US", role: "IGL" },
      { firstName: "Oscar", lastName: "Canellas", ign: "mixwell", nationality: "ES", role: "Duelist" },
      { firstName: "Mihail", lastName: "Kravchenko", ign: "d3ffo", nationality: "UA", role: "Initiator" },
      { firstName: "Chet", lastName: "Singh", ign: "Chet", nationality: "CA", role: "Sentinel" },
      { firstName: "David", lastName: "Cuesta", ign: "Davidp", nationality: "ES", role: "Controller" },
    ],
  },
  {
    name: "2Game Esports", tag: "2G", region: "Americas", budget: 800000, prestige: 55,
    players: [
      { firstName: "Luis", lastName: "Padilla", ign: "Nozwerr", nationality: "MX", role: "IGL" },
      { firstName: "Carlos", lastName: "Mendez", ign: "Flame", nationality: "MX", role: "Duelist" },
      { firstName: "Miguel", lastName: "Torres", ign: "Vortex", nationality: "MX", role: "Initiator" },
      { firstName: "Jorge", lastName: "Castillo", ign: "Sol", nationality: "MX", role: "Sentinel" },
      { firstName: "Ricardo", lastName: "Vera", ign: "Lobo", nationality: "MX", role: "Controller" },
    ],
  },

  // ─── Pacific ───
  {
    name: "Paper Rex", tag: "PRX", region: "Pacific", budget: 1800000, prestige: 92,
    players: [
      { firstName: "Jason", lastName: "Susanto", ign: "f0rsakeN", nationality: "ID", role: "Duelist" },
      { firstName: "Aaron", lastName: "Leonhart", ign: "mindfreak", nationality: "SG", role: "IGL" },
      { firstName: "Wang", lastName: "Jingjie", ign: "Jinggg", nationality: "SG", role: "Initiator" },
      { firstName: "Khalish", lastName: "Rusyaidee", ign: "d4v41", nationality: "MY", role: "Sentinel" },
      { firstName: "Benedict", lastName: "Miranda", ign: "Benkai", nationality: "SG", role: "Controller" },
    ],
  },
  {
    name: "DRX", tag: "DRX", region: "Pacific", budget: 1600000, prestige: 88,
    players: [
      { firstName: "Kim", lastName: "Gihwan", ign: "stax", nationality: "KR", role: "IGL" },
      { firstName: "Goo", lastName: "Yeongbeom", ign: "Rb", nationality: "KR", role: "Duelist" },
      { firstName: "Kim", lastName: "Myungkwan", ign: "MaKo", nationality: "KR", role: "Initiator" },
      { firstName: "Yu", lastName: "Jungwon", ign: "BuZz", nationality: "KR", role: "Sentinel" },
      { firstName: "Choi", lastName: "Yoonhwan", ign: "Flashback", nationality: "KR", role: "Controller" },
    ],
  },
  {
    name: "T1", tag: "T1", region: "Pacific", budget: 2000000, prestige: 85,
    players: [
      { firstName: "Son", lastName: "Minhyuk", ign: "xeta", nationality: "KR", role: "IGL" },
      { firstName: "Ha", lastName: "Dongmin", ign: "Sayaplayer", nationality: "KR", role: "Duelist" },
      { firstName: "Byeon", lastName: "Seonghwan", ign: "Munchkin", nationality: "KR", role: "Initiator" },
      { firstName: "Yoon", lastName: "Sungwoo", ign: "Carpe", nationality: "KR", role: "Sentinel" },
      { firstName: "Yoo", lastName: "Jungwoo", ign: "Bezel", nationality: "KR", role: "Controller" },
    ],
  },
  {
    name: "Gen.G", tag: "GEN", region: "Pacific", budget: 1700000, prestige: 82,
    players: [
      { firstName: "Lee", lastName: "Sungmin", ign: "Meteor", nationality: "KR", role: "IGL" },
      { firstName: "Seo", lastName: "Jaeyoung", ign: "Lakia", nationality: "KR", role: "Duelist" },
      { firstName: "Ko", lastName: "Jeongmin", ign: "t3xture", nationality: "KR", role: "Initiator" },
      { firstName: "Kang", lastName: "Minsoo", ign: "k1Ng", nationality: "KR", role: "Sentinel" },
      { firstName: "Yoon", lastName: "Hyunwoo", ign: "TS", nationality: "KR", role: "Controller" },
    ],
  },
  {
    name: "Global Esports", tag: "GE", region: "Pacific", budget: 1000000, prestige: 65,
    players: [
      { firstName: "Ganesh", lastName: "Gangadhar", ign: "SkRossi", nationality: "IN", role: "Duelist" },
      { firstName: "Bhavin", lastName: "Kotwani", ign: "HellrangeR", nationality: "IN", role: "IGL" },
      { firstName: "Akshay", lastName: "Singhania", ign: "KappA", nationality: "IN", role: "Initiator" },
      { firstName: "Jayanth", lastName: "Ramesh", ign: "Lightningfast", nationality: "IN", role: "Sentinel" },
      { firstName: "Sahil", lastName: "Choudhary", ign: "Monyet", nationality: "IN", role: "Controller" },
    ],
  },
  {
    name: "ZETA DIVISION", tag: "ZET", region: "Pacific", budget: 1200000, prestige: 70,
    players: [
      { firstName: "Koji", lastName: "Takeda", ign: "Laz", nationality: "JP", role: "IGL" },
      { firstName: "Tenta", lastName: "Asai", ign: "TENNN", nationality: "JP", role: "Duelist" },
      { firstName: "Shota", lastName: "Watanabe", ign: "SugarZ3ro", nationality: "JP", role: "Initiator" },
      { firstName: "Yuma", lastName: "Hashimoto", ign: "Dep", nationality: "JP", role: "Sentinel" },
      { firstName: "Ryo", lastName: "Takahashi", ign: "crow", nationality: "JP", role: "Controller" },
    ],
  },
  {
    name: "DetonatioN FocusMe", tag: "DFM", region: "Pacific", budget: 1100000, prestige: 68,
    players: [
      { firstName: "Takuya", lastName: "Suda", ign: "Anthem", nationality: "JP", role: "IGL" },
      { firstName: "Riki", lastName: "Inoue", ign: "SSeeS", nationality: "JP", role: "Duelist" },
      { firstName: "Yusuke", lastName: "Tanaka", ign: "Reita", nationality: "JP", role: "Initiator" },
      { firstName: "Daisuke", lastName: "Mori", ign: "Suggest", nationality: "JP", role: "Sentinel" },
      { firstName: "Haruto", lastName: "Nakamura", ign: "Seoldam", nationality: "JP", role: "Controller" },
    ],
  },
  {
    name: "Talon Esports", tag: "TLN", region: "Pacific", budget: 900000, prestige: 62,
    players: [
      { firstName: "Patiphan", lastName: "Chaiwong", ign: "Patiphan", nationality: "TH", role: "Duelist" },
      { firstName: "Thanachart", lastName: "Rungapajaratkul", ign: "Crws", nationality: "TH", role: "IGL" },
      { firstName: "Kittipong", lastName: "Tananuwat", ign: "foxz", nationality: "TH", role: "Initiator" },
      { firstName: "Itthirit", lastName: "Watchalanont", ign: "Sushiboys", nationality: "TH", role: "Sentinel" },
      { firstName: "Apiwat", lastName: "Apiraksiri", ign: "garnetS", nationality: "TH", role: "Controller" },
    ],
  },
  {
    name: "Rex Regum Qeon", tag: "RRQ", region: "Pacific", budget: 850000, prestige: 58,
    players: [
      { firstName: "Saibani", lastName: "Rahmad", ign: "fl1pzjder", nationality: "ID", role: "Duelist" },
      { firstName: "Cahya", lastName: "Nugraha", ign: "Lmemore", nationality: "ID", role: "IGL" },
      { firstName: "Firman", lastName: "Subakti", ign: "Tehbotol", nationality: "ID", role: "Initiator" },
      { firstName: "Rizky", lastName: "Nugraha", ign: "Estrella", nationality: "ID", role: "Sentinel" },
      { firstName: "Ahmad", lastName: "Fajar", ign: "Kozy", nationality: "ID", role: "Controller" },
    ],
  },
  {
    name: "Team Secret", tag: "TS", region: "Pacific", budget: 1300000, prestige: 72,
    players: [
      { firstName: "Jessie", lastName: "Cuyco", ign: "JessieVash", nationality: "PH", role: "IGL" },
      { firstName: "Riley", lastName: "Vega", ign: "witz", nationality: "PH", role: "Duelist" },
      { firstName: "Adrian", lastName: "Bacallo", ign: "Dispenser", nationality: "PH", role: "Initiator" },
      { firstName: "Jim", lastName: "Jalandoni", ign: "BORKUM", nationality: "PH", role: "Sentinel" },
      { firstName: "Jayvee", lastName: "Paguirigan", ign: "DubsteP", nationality: "PH", role: "Controller" },
    ],
  },
  {
    name: "Nongshim RedForce", tag: "NS", region: "Pacific", budget: 1400000, prestige: 75,
    players: [
      { firstName: "Park", lastName: "Minhyeok", ign: "Sylvan", nationality: "KR", role: "IGL" },
      { firstName: "Kim", lastName: "Sungmin", ign: "Lakia", nationality: "KR", role: "Duelist" },
      { firstName: "Lee", lastName: "Jiwon", ign: "Esekiel", nationality: "KR", role: "Initiator" },
      { firstName: "Choi", lastName: "Hyeonwoo", ign: "Lone", nationality: "KR", role: "Sentinel" },
      { firstName: "Jung", lastName: "Minyeong", ign: "Allow", nationality: "KR", role: "Controller" },
    ],
  },
  {
    name: "BOOM Esports", tag: "BME", region: "Pacific", budget: 800000, prestige: 55,
    players: [
      { firstName: "Gary", lastName: "Setiawan", ign: "blaZek1ng", nationality: "ID", role: "Duelist" },
      { firstName: "David", lastName: "Monangin", ign: "Tehbotol", nationality: "ID", role: "IGL" },
      { firstName: "Saibani", lastName: "Rahmad", ign: "fl1pzjder", nationality: "ID", role: "Initiator" },
      { firstName: "Rizky", lastName: "Fauzan", ign: "BerserX", nationality: "ID", role: "Sentinel" },
      { firstName: "Kevin", lastName: "Gunawan", ign: "Famouz", nationality: "ID", role: "Controller" },
    ],
  },

  // ─── China ───
  {
    name: "Edward Gaming", tag: "EDG", region: "China", budget: 2500000, prestige: 90,
    players: [
      { firstName: "Zhuo", lastName: "Yingzhe", ign: "ZmjjKK", nationality: "CN", role: "Duelist" },
      { firstName: "Guo", lastName: "Haowen", ign: "nobody", nationality: "CN", role: "IGL" },
      { firstName: "Hao", lastName: "Ruilin", ign: "Haodong", nationality: "CN", role: "Initiator" },
      { firstName: "Wang", lastName: "Yifan", ign: "S1Mon", nationality: "CN", role: "Sentinel" },
      { firstName: "Chen", lastName: "Xiao", ign: "Smoggy", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Bilibili Gaming", tag: "BLG", region: "China", budget: 2000000, prestige: 85,
    players: [
      { firstName: "Li", lastName: "Junfeng", ign: "whzy", nationality: "CN", role: "Duelist" },
      { firstName: "Wu", lastName: "Zehao", ign: "knight", nationality: "CN", role: "IGL" },
      { firstName: "Zhang", lastName: "Wei", ign: "Biank", nationality: "CN", role: "Initiator" },
      { firstName: "Liu", lastName: "Haoran", ign: "FLAVOR", nationality: "CN", role: "Sentinel" },
      { firstName: "Chen", lastName: "Zhiyu", ign: "AAAY", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "FunPlus Phoenix", tag: "FPX", region: "China", budget: 2200000, prestige: 88,
    players: [
      { firstName: "Andrey", lastName: "Sorokin", ign: "SUYGETSU", nationality: "RU", role: "Duelist" },
      { firstName: "Dmitriy", lastName: "Lychkov", ign: "ANGE1", nationality: "UA", role: "IGL" },
      { firstName: "Ardis", lastName: "Svarenieks", ign: "ardiis", nationality: "LV", role: "Initiator" },
      { firstName: "Zhao", lastName: "Kai", ign: "JEEMZZ", nationality: "CN", role: "Sentinel" },
      { firstName: "Li", lastName: "Wenbo", ign: "Lysorez", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Trace Esports", tag: "TE", region: "China", budget: 1500000, prestige: 75,
    players: [
      { firstName: "Zhang", lastName: "Peng", ign: "Eagle", nationality: "CN", role: "Duelist" },
      { firstName: "Wang", lastName: "Hao", ign: "ViVi", nationality: "CN", role: "IGL" },
      { firstName: "Liu", lastName: "Chen", ign: "LuoK1ng", nationality: "CN", role: "Initiator" },
      { firstName: "Yang", lastName: "Jie", ign: "Yezi", nationality: "CN", role: "Sentinel" },
      { firstName: "Sun", lastName: "Ming", ign: "Aurora", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "JD Gaming", tag: "JDG", region: "China", budget: 1800000, prestige: 80,
    players: [
      { firstName: "Huang", lastName: "Zekai", ign: "abo", nationality: "CN", role: "Duelist" },
      { firstName: "Chen", lastName: "Wei", ign: "Kai", nationality: "CN", role: "IGL" },
      { firstName: "Li", lastName: "Nan", ign: "NaN", nationality: "CN", role: "Initiator" },
      { firstName: "Wang", lastName: "Lei", ign: "Zorro", nationality: "CN", role: "Sentinel" },
      { firstName: "Zhou", lastName: "Fei", ign: "Spirit", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "All Gamers", tag: "AG", region: "China", budget: 1200000, prestige: 68,
    players: [
      { firstName: "Liu", lastName: "Yang", ign: "Yuicaw", nationality: "CN", role: "Duelist" },
      { firstName: "Zhang", lastName: "Hao", ign: "Monk", nationality: "CN", role: "IGL" },
      { firstName: "Xu", lastName: "Cheng", ign: "Wolfey", nationality: "CN", role: "Initiator" },
      { firstName: "Li", lastName: "Tao", ign: "B1gA", nationality: "CN", role: "Sentinel" },
      { firstName: "Wang", lastName: "Jun", ign: "Allez", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Dragon Ranger Gaming", tag: "DRG", region: "China", budget: 1000000, prestige: 62,
    players: [
      { firstName: "Chen", lastName: "Yu", ign: "Sniper", nationality: "CN", role: "Duelist" },
      { firstName: "Wu", lastName: "Long", ign: "Drake", nationality: "CN", role: "IGL" },
      { firstName: "Zhao", lastName: "Ming", ign: "Flame", nationality: "CN", role: "Initiator" },
      { firstName: "Sun", lastName: "Wei", ign: "Phoenix", nationality: "CN", role: "Sentinel" },
      { firstName: "Lin", lastName: "Jie", ign: "Typhoon", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Nova Esports", tag: "Nova", region: "China", budget: 1100000, prestige: 65,
    players: [
      { firstName: "Yang", lastName: "Kai", ign: "Supernova", nationality: "CN", role: "Duelist" },
      { firstName: "Zhang", lastName: "Lei", ign: "Pulsar", nationality: "CN", role: "IGL" },
      { firstName: "Li", lastName: "Wei", ign: "Orbit", nationality: "CN", role: "Initiator" },
      { firstName: "Wang", lastName: "Zhi", ign: "Cosmos", nationality: "CN", role: "Sentinel" },
      { firstName: "Zhou", lastName: "Hao", ign: "Nebula", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Wolves Esports", tag: "WOL", region: "China", budget: 900000, prestige: 58,
    players: [
      { firstName: "Liu", lastName: "Fang", ign: "Howl", nationality: "CN", role: "Duelist" },
      { firstName: "Chen", lastName: "Gang", ign: "Fang", nationality: "CN", role: "IGL" },
      { firstName: "Wang", lastName: "Qiang", ign: "Shadow", nationality: "CN", role: "Initiator" },
      { firstName: "Li", lastName: "Bo", ign: "Lunar", nationality: "CN", role: "Sentinel" },
      { firstName: "Zhang", lastName: "Tao", ign: "Pack", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Titan Esports Gaming", tag: "TEC", region: "China", budget: 850000, prestige: 55,
    players: [
      { firstName: "Wu", lastName: "Hao", ign: "Colossal", nationality: "CN", role: "Duelist" },
      { firstName: "Zhao", lastName: "Gang", ign: "Forge", nationality: "CN", role: "IGL" },
      { firstName: "Sun", lastName: "Lei", ign: "Anvil", nationality: "CN", role: "Initiator" },
      { firstName: "Lin", lastName: "Ming", ign: "Hammer", nationality: "CN", role: "Sentinel" },
      { firstName: "Yang", lastName: "Chen", ign: "Smelter", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Tyloo", tag: "TYL", region: "China", budget: 1300000, prestige: 72,
    players: [
      { firstName: "Zhu", lastName: "Weijie", ign: "SLOWLY", nationality: "CN", role: "Duelist" },
      { firstName: "Liu", lastName: "Ming", ign: "Jetta", nationality: "CN", role: "IGL" },
      { firstName: "Wang", lastName: "Peng", ign: "Freeman", nationality: "CN", role: "Initiator" },
      { firstName: "Chen", lastName: "Xin", ign: "Motor", nationality: "CN", role: "Sentinel" },
      { firstName: "Li", lastName: "Hong", ign: "Vibe", nationality: "CN", role: "Controller" },
    ],
  },
  {
    name: "Top Esports", tag: "TES", region: "China", budget: 1600000, prestige: 78,
    players: [
      { firstName: "Huang", lastName: "Sheng", ign: "Flex", nationality: "CN", role: "Duelist" },
      { firstName: "Zhou", lastName: "Wei", ign: "Captain", nationality: "CN", role: "IGL" },
      { firstName: "Liu", lastName: "Xiang", ign: "Blitz", nationality: "CN", role: "Initiator" },
      { firstName: "Wang", lastName: "Bo", ign: "Clamp", nationality: "CN", role: "Sentinel" },
      { firstName: "Zhang", lastName: "Yu", ign: "Sage", nationality: "CN", role: "Controller" },
    ],
  },
];

// ── Main seed function ──

async function main() {
  console.log("Seeding database...\n");

  // Clear existing data
  await prisma.match.deleteMany();
  await prisma.player.deleteMany();
  await prisma.team.deleteMany();
  await prisma.vctTeamTemplate.deleteMany();
  await prisma.season.deleteMany();

  console.log("Cleared existing data.");

  // Create Season
  await prisma.season.create({
    data: {
      number: 1,
      year: 2026,
      currentStage: "KICKOFF",
      currentDay: 1,
      currentWeek: 1,
      isActive: true,
    },
  });
  console.log("Created Season 1 (2026).");

  // Create VctTeamTemplates and Players
  let totalPlayers = 0;

  for (const teamDef of TEAMS) {
    // Create the VCT team template
    await prisma.vctTeamTemplate.create({
      data: {
        name: teamDef.name,
        tag: teamDef.tag,
        region: teamDef.region,
        budget: teamDef.budget,
        prestige: teamDef.prestige,
      },
    });

    // Create players for this team
    for (const playerDef of teamDef.players) {
      const acs = round2(randFloat(180, 280));
      const kd = round2(randFloat(0.85, 1.45));
      const adr = round2(randFloat(130, 180));
      const kast = round2(randFloat(65, 80));
      const hs = round2(randFloat(20, 35));
      const salary = calcSalary(acs, kd, adr, kast);
      const age = randInt(18, 28);

      await prisma.player.create({
        data: {
          ign: playerDef.ign,
          firstName: playerDef.firstName,
          lastName: playerDef.lastName,
          nationality: playerDef.nationality,
          age,
          role: playerDef.role,
          region: teamDef.region,
          tier: "VCT" as PlayerTier,
          currentTeam: teamDef.name,
          salary,
          acs,
          kd,
          adr,
          kast,
          hs,
          imageUrl: `https://placehold.co/200x200/16161E/ECE8E1?text=${encodeURIComponent(playerDef.ign)}`,
          isActive: true,
          isRetired: false,
        },
      });

      totalPlayers++;
    }
  }

  console.log(`Created ${TEAMS.length} team templates and ${totalPlayers} players.`);

  // Create some additional free agents
  const freeAgentNames = [
    { firstName: "Alex", lastName: "Rivera", ign: "Phantom", nationality: "US", region: "Americas" as Region },
    { firstName: "Kim", lastName: "Seoyoon", ign: "Requiem", nationality: "KR", region: "Pacific" as Region },
    { firstName: "Lucas", lastName: "Ferreiro", ign: "Vandal", nationality: "BR", region: "Americas" as Region },
    { firstName: "Yuki", lastName: "Tanaka", ign: "Shogun", nationality: "JP", region: "Pacific" as Region },
    { firstName: "Emil", lastName: "Karlsson", ign: "Frostbite", nationality: "SE", region: "EMEA" as Region },
    { firstName: "Hassan", lastName: "Al-Farsi", ign: "Sandstorm", nationality: "AE", region: "EMEA" as Region },
    { firstName: "Wei", lastName: "Huang", ign: "Thunder", nationality: "CN", region: "China" as Region },
    { firstName: "Marco", lastName: "Rossi", ign: "Viper", nationality: "IT", region: "EMEA" as Region },
    { firstName: "Javier", lastName: "Moreno", ign: "Recon", nationality: "ES", region: "EMEA" as Region },
    { firstName: "Tomas", lastName: "Novak", ign: "Spectre", nationality: "CZ", region: "EMEA" as Region },
    { firstName: "Chen", lastName: "Liang", ign: "Dragon", nationality: "CN", region: "China" as Region },
    { firstName: "Park", lastName: "Jihoon", ign: "Cipher", nationality: "KR", region: "Pacific" as Region },
    { firstName: "Andre", lastName: "Silva", ign: "Bucky", nationality: "BR", region: "Americas" as Region },
    { firstName: "Raj", lastName: "Patel", ign: "Spectra", nationality: "IN", region: "Pacific" as Region },
    { firstName: "Leon", lastName: "Muller", ign: "Blaze", nationality: "DE", region: "EMEA" as Region },
    { firstName: "Ivan", lastName: "Petrov", ign: "Stinger", nationality: "RU", region: "EMEA" as Region },
    { firstName: "Felipe", lastName: "Santos", ign: "Fury", nationality: "BR", region: "Americas" as Region },
    { firstName: "Kenji", lastName: "Sato", ign: "Ronin", nationality: "JP", region: "Pacific" as Region },
    { firstName: "Zhao", lastName: "Xiaoming", ign: "Mystic", nationality: "CN", region: "China" as Region },
    { firstName: "Diego", lastName: "Hernandez", ign: "Hawk", nationality: "MX", region: "Americas" as Region },
  ];

  let freeAgentCount = 0;
  for (const fa of freeAgentNames) {
    const role = ROLES[randInt(0, ROLES.length - 1)]!;
    const acs = round2(randFloat(180, 250));
    const kd = round2(randFloat(0.85, 1.25));
    const adr = round2(randFloat(130, 170));
    const kast = round2(randFloat(65, 75));
    const hs = round2(randFloat(20, 32));
    const salary = calcSalary(acs, kd, adr, kast);
    const age = randInt(18, 28);

    await prisma.player.create({
      data: {
        ign: fa.ign,
        firstName: fa.firstName,
        lastName: fa.lastName,
        nationality: fa.nationality,
        age,
        role,
        region: fa.region,
        tier: "VCL" as PlayerTier,
        currentTeam: null,
        teamId: null,
        salary,
        acs,
        kd,
        adr,
        kast,
        hs,
        imageUrl: `https://placehold.co/200x200/16161E/ECE8E1?text=${encodeURIComponent(fa.ign)}`,
        isActive: true,
        isRetired: false,
      },
    });
    freeAgentCount++;
  }

  console.log(`Created ${freeAgentCount} free agents.`);
  console.log("\nSeed complete!");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
