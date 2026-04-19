export interface ValorantAgent {
  name: string;
  psId: number;
  role: "Duelist" | "Initiator" | "Sentinel" | "Controller";
  portraitUrl: string;
}

export const VALORANT_AGENTS: ValorantAgent[] = [
  // Duelists
  { name: "Jett", psId: 344, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/344/jett_icon-png-png-png-png-png-png-png-png-png" },
  { name: "Raze", psId: 397, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/397/raze_icon-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Reyna", psId: 434, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/434/reyna_icon-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Phoenix", psId: 385, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/385/phoenix_icon-png-png-png-png-png-png-png-png" },
  { name: "Neon", psId: 393, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/393/neon_icon-png-png-png-png-png-png-png-png-png" },
  { name: "Yoru", psId: 440, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/440/yoru_icon-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Iso", psId: 392, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/392/iso_icon-png-png-png-png-png-png" },
  { name: "Waylay", psId: 395, role: "Duelist", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/395/waylay_icon-png-png-png-png" },
  // Initiators
  { name: "Sova", psId: 429, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/429/sova_icon-png-png-png-png-png-png-png-png-png" },
  { name: "Breach", psId: 418, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/418/breach_icon-png-png-png-png-png-png-png-png" },
  { name: "Skye", psId: 439, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/439/skye_icon-png-png-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "KAY/O", psId: 432, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/432/kayo_icon-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Fade", psId: 388, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/388/fade_icon-png-png-png-png-png" },
  { name: "Gekko", psId: 435, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/435/gekko_icon-png-png-png-png-png-png-png-png" },
  { name: "Tejo", psId: 422, role: "Initiator", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/422/tejo_icon-png-png-png-png-png-png" },
  // Sentinels
  { name: "Killjoy", psId: 412, role: "Sentinel", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/412/killjoy_icon-png-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Cypher", psId: 426, role: "Sentinel", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/426/cypher_icon-png-png-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Sage", psId: 438, role: "Sentinel", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/438/sage_icon-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Chamber", psId: 329, role: "Sentinel", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/329/chamber_icon-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Deadlock", psId: 427, role: "Sentinel", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/427/50px-deadlock_valorant_icon-png-png-png-png-png-png-png-png" },
  { name: "Vyse", psId: 423, role: "Sentinel", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/423/vyse_icon-png-png-png-png-png-png-png-png" },
  // Controllers
  { name: "Brimstone", psId: 419, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/419/brimstone_icon-png-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Viper", psId: 401, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/401/viper_icon-png-png-png-png-png-png-png-png-png" },
  { name: "Omen", psId: 409, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/409/omen_icon-png-png-png-png-png-png-png-png-png-png-png" },
  { name: "Astra", psId: 424, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/424/astra_icon-png-png-png-png-png-png-png-png" },
  { name: "Harbor", psId: 433, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/433/harbor_icon-png-png-png-png-png-png-png-png-png" },
  { name: "Clove", psId: 437, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/437/clove_icon-png-png-png-png-png-png-png" },
  { name: "Miks", psId: 436, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/436/ezgif-874c0740190b87ff-png" },
  { name: "Veto", psId: 430, role: "Controller", portraitUrl: "https://cdn-api.pandascore.co/images/valorant/agent/image/430/veto_icon-png-png-png" },
];

export const AGENTS_BY_ROLE = (role: ValorantAgent["role"]) =>
  VALORANT_AGENTS.filter(a => a.role === role);

export function getAgentByName(name: string): ValorantAgent | undefined {
  return VALORANT_AGENTS.find(a => a.name === name);
}
