export const TABLES={
 Players:{label:'选手',file:'Players.csv',key:'Id',display:'Nick',folder:'Players',icon:'◈'},
 Staff:{label:'职员',file:'Staff.csv',key:'Id',display:'Nick',folder:'Staffs',icon:'◎'},
 Teams:{label:'战队',file:'Teams.csv',key:'Nick',display:'Nick',folder:'Teams',icon:'⬡'},
 Sponsors:{label:'赞助商',file:'Sponsors.csv',key:'Num',display:'CompanyName',folder:'Sponsors',icon:'◇'},
 Tournaments:{label:'原生赛事模板',file:'Tournaments.csv',key:'id',display:'Name',folder:'Tournaments',icon:'♜'}
};
export const LABELS={Nick:'昵称',Name:'名字 / 名称',Surname:'姓氏',Birthdate:'出生日期',Country:'国家 / 地区',Team:'所属战队',Skill:'当前能力',Potential:'潜力',AWP:'狙击',Awp:'狙击',Rifle:'步枪',Pistol:'手枪',Reaction:'反应',Tactic:'战术',Leader:'领导力',Creativity:'创造力',Teamwork:'团队合作',Conflict:'冲突属性',Morale:'士气',Loyalty:'忠诚',Grenades:'投掷物',Clutch:'残局',PR:'公关',Productivity:'效率', 'Stress Resistance':'抗压',StressResistance:'抗压',Perception:'感知',Health:'健康',Strength:'力量',Endurance:'耐力',Role1:'主要角色',Role2:'第二角色',Role3:'第三角色',Earnings:'累计奖金',Bio:'人物简介',Id:'唯一 ID',id:'唯一 ID',HLTV:'HLTV 链接',Liquipedia:'Liquipedia 链接',Faceit:'FACEIT 链接',PhotoUrl:'原始图片链接',Retired:'已退役',FromFaceIt:'来自 FACEIT',Gender:'性别',CreatedBy:'创建者',CreatedAt:'创建时间',Role:'职务',Physiotherapy:'理疗',Fitness:'体能训练',Playerability:'选手培养',Evaluation:'能力评估',Scouting:'球探',Psychology:'心理',Analysis:'分析',Insight:'洞察',Publicrelations:'公共关系',Financemanagement:'财务管理',Legalknowledge:'法律知识',Contractwork:'合同谈判',Eventorganization:'活动组织',Leadership:'领导力',Vision:'远见',Delegation:'授权',PublicImage:'公众形象',Communication:'沟通',FinancialLiteracy:'财务素养',Immunity:'免疫力',Generated:'游戏生成',Rating:'评级',ERS:'ERS 积分',Description:'介绍',Academy:'青训队',BgColor:'主题颜色',StartIGL:'首发指挥',FPmap:'首选地图 1',SPmap:'首选地图 2',TPmap:'首选地图 3',FBmap:'禁用地图 1',SBmap:'禁用地图 2',TBmap:'禁用地图 3',Disbanded:'已解散',Female:'女子战队',Num:'编号',CompanyName:'公司名称',Tier:'级别',Type:'类型',Prizefund:'奖金池',CupId:'赛事图标 ID',City:'举办城市'};
export const ATTRIBUTE_FIELDS=new Set(['Skill','Potential','AWP','Awp','Rifle','Pistol','Reaction','Tactic','Leader','Creativity','Teamwork','Conflict','Morale','Loyalty','Grenades','Clutch','PR','Productivity','Stress Resistance','StressResistance','Perception','Health','Strength','Endurance','Physiotherapy','Fitness','Playerability','Evaluation','Scouting','Psychology','Analysis','Insight','Publicrelations','Financemanagement','Legalknowledge','Contractwork','Eventorganization','Leadership','Vision','Delegation','PublicImage','Communication','FinancialLiteracy','Immunity']);
export const BOOLEAN_FIELDS=new Set(['Retired','FromFaceIt','Generated','Disbanded','Female']);
export const NUMERIC_FIELDS=new Set([...ATTRIBUTE_FIELDS,'Earnings','Rating','ERS','Prizefund','Num']);
export const LONG_FIELDS=new Set(['Bio','Description']);
export function fieldInfo(table,field,rows) {
 let type=LONG_FIELDS.has(field)?'textarea':BOOLEAN_FIELDS.has(field)?'boolean':NUMERIC_FIELDS.has(field)?'number':field==='BgColor'?'color':field==='Gender'?'gender':'text';
 const observed=[...new Set(rows.map(r=>r[field]).filter(x=>x!==''))];
 const choices=['Role','Role1','Role2','Role3','Country','Team','Academy','StartIGL','Tier','Type','FPmap','SPmap','TPmap','FBmap','SBmap','TBmap'].includes(field)?observed.sort((a,b)=>a.localeCompare(b)):undefined;
 return {name:field,label:LABELS[field]||field,type,choices,attribute:ATTRIBUTE_FIELDS.has(field),key:field===TABLES[table].key};
}
