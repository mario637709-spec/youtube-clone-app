// @ts-nocheck
// All available thumbnail images
export const thumbnails = [
  'Abandoned_city_skyscraper_post-a…_202606102130.jpeg',
  'Abandoned_island_base_radio_dish_202606102140.jpeg',
  'Arctic_fortress_in_glacier_202606102130.jpeg',
  'Bank_vault_overflowing_with_gold_202606102130.jpeg',
  'Crystal_forest_research_station_202606102140.jpeg',
  'Cyberpunk_greenhouse_on_skyscraper_202606102140.jpeg',
  'Cyberpunk_secret_hidden_laboratory_202606102130.jpeg',
  'Diamond_cave_discovery_giant_dia…_202606102130.jpeg',
  'Floating_island_with_mansion_wat…_202606102130.jpeg',
  'Floating_sky_city_among_clouds_202606102140.jpeg',
  'Futuristic_city_in_canyon_202606102130.jpeg',
  'Giant_storm_chaser_vehicle_tornado_202606102130.jpeg',
  'Glass_pod_on_mountain_peak_202606102141.jpeg',
  'Glowing_research_base_deep_ocean_202606102130.jpeg',
  'Golden_temple_behind_waterfall_202606102130.jpeg',
  'Hidden_desert_vault_steel_door_202606102141.jpeg',
  'image.png_202606102130_2.jpeg',
  'image.png_202606102130.jpeg',
  'Lava_race_track_in_cavern_202606102130.jpeg',
  'Luxury_suite_in_space_station_202606102130.jpeg',
  'Mega-bridge_spanning_ocean_whirl…_202606102130.jpeg',
  'Mega-prize_vault_cash_cars_202606102140.jpeg',
  'Sunken_shipwreck_overflowing_gol…_202606102141.jpeg',
  'Survival_pod_on_volcanic_crater_202606102130.jpeg',
  'Treehouse_mansion_in_forest_202606102130.jpeg',
  'Underground_bunker_with_indoor_f…_202606102130.jpeg',
  'Underwater_tunnel_with_sharks_202606102140.jpeg',
];

// Helper to get thumbnail path
export const getThumbnailPath = (filename) => {
  return `/images/${filename}`;
};

// Random thumbnail selector
export const getRandomThumbnail = () => {
  const randomIndex = Math.floor(Math.random() * thumbnails.length);
  return getThumbnailPath(thumbnails[randomIndex]);
};
