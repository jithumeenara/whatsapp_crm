export const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Argentina','Australia','Austria','Bangladesh',
  'Belgium','Brazil','Canada','Chile','China','Colombia','Croatia','Czech Republic',
  'Denmark','Egypt','Ethiopia','Finland','France','Germany','Ghana','Greece',
  'Guatemala','Hungary','India','Indonesia','Iran','Iraq','Ireland','Israel',
  'Italy','Japan','Jordan','Kazakhstan','Kenya','South Korea','Kuwait',
  'Lebanon','Libya','Malaysia','Mexico','Morocco','Myanmar','Nepal',
  'Netherlands','New Zealand','Nigeria','Norway','Pakistan','Peru','Philippines',
  'Poland','Portugal','Qatar','Romania','Russia','Saudi Arabia','Singapore',
  'South Africa','Spain','Sri Lanka','Sudan','Sweden','Switzerland','Syria',
  'Tanzania','Thailand','Turkey','Ukraine','United Arab Emirates','United Kingdom',
  'United States','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zimbabwe',
]

// States per country (most common)
const STATE_MAP: Record<string, string[]> = {
  'United States': [
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
    'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
    'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
    'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
    'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
    'Wisconsin','Wyoming',
  ],
  'India': [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa',
    'Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala',
    'Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland',
    'Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
    'Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
    'Chandigarh','Puducherry',
  ],
  'Australia': [
    'New South Wales','Victoria','Queensland','Western Australia','South Australia',
    'Tasmania','Northern Territory','Australian Capital Territory',
  ],
  'Canada': [
    'Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador',
    'Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island',
    'Quebec','Saskatchewan','Yukon',
  ],
  'United Kingdom': [
    'England','Scotland','Wales','Northern Ireland',
  ],
  'Germany': [
    'Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse',
    'Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate',
    'Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia',
  ],
  'Brazil': [
    'Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Espírito Santo','Goiás',
    'Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba',
    'Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte',
    'Rio Grande do Sul','Rondônia','Roraima','Santa Catarina','São Paulo',
    'Sergipe','Tocantins','Distrito Federal',
  ],
  'Mexico': [
    'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas',
    'Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Estado de México',
    'Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán','Morelos','Nayarit',
    'Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí',
    'Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas',
  ],
  'China': [
    'Anhui','Beijing','Chongqing','Fujian','Gansu','Guangdong','Guangxi','Guizhou',
    'Hainan','Hebei','Heilongjiang','Henan','Hubei','Hunan','Inner Mongolia',
    'Jiangsu','Jiangxi','Jilin','Liaoning','Ningxia','Qinghai','Shaanxi','Shandong',
    'Shanghai','Shanxi','Sichuan','Tianjin','Tibet','Xinjiang','Yunnan','Zhejiang',
  ],
  'Pakistan': [
    'Balochistan','Gilgit-Baltistan','Khyber Pakhtunkhwa','Punjab','Sindh',
    'Azad Kashmir','Islamabad Capital Territory',
  ],
}

export function getStatesForCountry(country: string): string[] {
  return STATE_MAP[country] ?? []
}
