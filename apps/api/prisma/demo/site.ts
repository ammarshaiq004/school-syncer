// Public websites for the three demo schools (each with its own look), so
// /s/demo-school, /s/bright-future and /s/online-academy work straight after the seed.
import type { PrismaClient } from '@prisma/client';
import type { SiteInput } from '../../src/site/site-config.js';

const plusDays = (today: string, n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const CONTENT: Record<string, (today: string) => SiteInput> = {
  'demo-school': (today) => ({
    theme: { primary: '#4f46e5', accent: '#f59e0b', font: 'editorial', scene: 'campus', corners: 'soft', appearance: 'light' },
    hero: {
      tagline: 'Two campuses, one family in Lahore',
      headline: 'Where curious minds find their way',
      subheadline: 'City Grammar School teaches from Playgroup to Grade 8 on two Lahore campuses, with live online classes for the upper grades.',
      notice: 'Admissions are open for the new session. Seats in Prep and Grade 1 are filling quickly.',
    },
    about: {
      title: 'A school that knows every child by name',
      body:
        'City Grammar School began as a single classroom in Model Town and has grown into two campuses without losing the habit of knowing every child.\n\n' +
        'Our teachers keep classes small, send honest progress reports and run weekly clubs so that every student finds something they love to do well.',
      motto: 'Curious today, capable tomorrow.',
      values: [
        { title: 'Curiosity first', text: 'Questions are the start of every lesson, not an interruption.', icon: 'bulb' },
        { title: 'Kindness counts', text: 'We teach manners and care for others as seriously as mathematics.', icon: 'heart' },
        { title: 'Honest reporting', text: 'Parents see attendance, homework and results as they happen.', icon: 'shield' },
        { title: 'Effort is celebrated', text: 'A weekly assembly recognises trying hard, not only top marks.', icon: 'star' },
      ],
    },
    programs: [
      { title: 'Early years', ages: 'Playgroup to Prep', text: 'Stories, songs, sand and shapes. Children learn letters and numbers through play, in rooms built at their height.', icon: 'palette' },
      { title: 'Primary school', ages: 'Grades 1 to 5', text: 'Reading and writing in English and Urdu, number sense, science through experiments and a weekly library hour.', icon: 'book' },
      { title: 'Middle school', ages: 'Grades 6 to 8', text: 'Subject teachers, a computer lab, live online classes and project weeks that turn knowing into understanding.', icon: 'flask' },
      { title: 'Clubs and sport', ages: 'All grades', text: 'Debate, robotics, art, cricket and football every Thursday, with an inter-campus sports day each winter.', icon: 'trophy' },
    ],
    admissions: {
      intro: 'Apply online in two minutes. The admissions office will call to arrange a visit and a friendly assessment.',
      requirements: ['Child’s B-form or birth certificate', 'Last report card (Grade 1 and above)', 'Two passport-size photographs', 'Parent or guardian CNIC copy'],
      deadline: 'Applications for the new session close on 30 November',
    },
    fees: {
      note: 'Fees are charged monthly and can be paid at the office or online by JazzCash, Easypaisa and 1Bill. Siblings receive a discount.',
      rows: [
        { label: 'Admission fee (once)', amount: 15000, per: '' },
        { label: 'Early years tuition', amount: 9500, per: '/ month' },
        { label: 'Primary tuition', amount: 11000, per: '/ month' },
        { label: 'Middle school tuition', amount: 13500, per: '/ month' },
        { label: 'Transport (by distance)', amount: 4500, per: 'from / month' },
      ],
    },
    news: [
      { title: 'Grade 7 robotics team wins the city final', date: plusDays(today, -6), text: 'Four students from Model Town built a line-following robot in six weeks and beat 18 schools at the Lahore youth tech fair.' },
      { title: 'New science lab opens at Johar Town', date: plusDays(today, -16), text: 'The campus now has a dedicated lab with a bench for every pair of students, so every experiment is hands-on.' },
      { title: 'Parent-teacher meetings go online', date: plusDays(today, -27), text: 'Parents can now book a ten-minute slot from the portal and meet the teacher by video if travelling is difficult.' },
    ],
    events: [
      { title: 'Open day, Model Town campus', date: plusDays(today, 5), time: '10:00 am', place: 'Model Town', kind: 'event' },
      { title: 'Parent-teacher meetings', date: plusDays(today, 12), time: '9:00 am to 1:00 pm', place: 'Both campuses', kind: 'academic' },
      { title: 'Mid-term exams begin', date: plusDays(today, 19), time: '', place: '', kind: 'exam' },
      { title: 'Mid-term exams end', date: plusDays(today, 23), time: '', place: '', kind: 'exam' },
      { title: 'Winter sports day', date: plusDays(today, 31), time: '8:30 am', place: 'Model Town ground', kind: 'event' },
      { title: 'School closed', date: plusDays(today, 36), time: '', place: '', kind: 'holiday' },
      { title: 'Science fair', date: plusDays(today, 44), time: '10:00 am', place: 'Johar Town', kind: 'event' },
    ],
    faculty: [
      { name: 'Ayesha Siddiqui', role: 'Principal', bio: 'Twenty years in classrooms and a belief that every child can read well by Grade 3.' },
      { name: 'Bilal Chaudhry', role: 'Head of Science', bio: 'Builds a new experiment into every lesson. Runs the robotics club.' },
      { name: 'Sana Malik', role: 'Early years lead', bio: 'Montessori trained, with a gift for turning tears into giggles on the first day.' },
      { name: 'Imran Qureshi', role: 'Mathematics and Computer', bio: 'Believes everyone is a maths person once the right teacher shows up.' },
    ],
    testimonials: [
      { quote: 'My son used to hide his reading book. Two terms in Ms Sana’s class and he reads aloud to his little sister every night.', name: 'Farhan Sheikh', relation: 'Father of a Grade 2 student' },
      { quote: 'The parent portal means I always know about homework and fees. No more guessing, no more chasing.', name: 'Nadia Hussain', relation: 'Mother of two' },
      { quote: 'Teachers answer messages on the same day. That alone made us choose this school.', name: 'Kamran Ali', relation: 'Father of a Grade 6 student' },
    ],
    faq: [
      { q: 'Which classes can I apply for?', a: 'We admit from Playgroup to Grade 8. Seats in Prep and Grade 1 are the most requested, so apply early.' },
      { q: 'Is there an entry test?', a: 'Grades 1 and above sit a short, friendly assessment in English and mathematics. Early years children simply spend a morning with our teachers.' },
      { q: 'Do you offer transport?', a: 'Yes. Vans run on set routes across Model Town, Johar Town and nearby areas. The office will share routes and fares.' },
      { q: 'Can my child attend classes online?', a: 'Grades 5 to 8 have live online classes alongside campus teaching, which helps on rainy days and during exams.' },
      { q: 'How do parents follow progress?', a: 'Every parent gets a portal and mobile app login showing attendance, homework, results and fee dues for each child.' },
    ],
    contact: { address: '12-C Model Town, Lahore', hours: 'Monday to Saturday, 8:00 am to 2:00 pm', whatsapp: '0300 1234567', facebook: 'https://facebook.com', instagram: 'https://instagram.com', youtube: 'https://youtube.com' },
    seo: { title: 'City Grammar School, Lahore', description: 'City Grammar School in Lahore: Playgroup to Grade 8 on two campuses, with online classes and a parent portal. Admissions open.' },
  }),

  'bright-future': (today) => ({
    theme: { primary: '#0f766e', accent: '#f97316', font: 'friendly', scene: 'campus', corners: 'soft', appearance: 'light' },
    hero: {
      tagline: 'Learning with heart, Faisalabad',
      headline: 'Big smiles, bright minds, a happy first step',
      subheadline: 'A warm neighbourhood school on Susan Road where small classes and kind teachers help every child grow in confidence.',
      notice: 'Registration for Nursery and Prep is open until the end of next month.',
    },
    about: {
      title: 'A school with the door always open',
      body: 'Bright Future School is a neighbourhood school with a simple promise: your child will be known, encouraged and challenged.\n\nParents are welcome in the corridor, teachers share their phone hours, and every term ends with a showcase where children teach their families something new.',
      motto: 'Every child shines differently.',
      values: [
        { title: 'Small classes', text: 'No more than 25 children, so no child is lost.', icon: 'people' },
        { title: 'Play and purpose', text: 'Learning through activity from the very first day.', icon: 'palette' },
        { title: 'Strong foundations', text: 'English, Urdu and number sense before everything else.', icon: 'book' },
        { title: 'Growing together', text: 'Teachers and parents work as one team.', icon: 'leaf' },
      ],
    },
    programs: [
      { title: 'Nursery and Prep', ages: 'Ages 3 to 5', text: 'Play-based days with phonics, counting games, rhymes and story time.', icon: 'palette' },
      { title: 'Primary', ages: 'Grades 1 to 5', text: 'Careful reading, neat writing, confident mathematics and weekly nature walks.', icon: 'book' },
      { title: 'Middle', ages: 'Grades 6 to 8', text: 'Science projects, a computer class and a library full of stories.', icon: 'globe' },
    ],
    admissions: {
      intro: 'Send a quick enquiry and we will call you to arrange a visit.',
      requirements: ['Child’s B-form or birth certificate', 'Previous school leaving certificate, if any', 'Two photographs'],
      deadline: 'Registration closes the last day of next month',
    },
    fees: {
      note: 'Fees are due by the 10th of each month. Please ask the office about sibling discounts.',
      rows: [
        { label: 'Registration', amount: 3000, per: '' },
        { label: 'Nursery and Prep', amount: 4500, per: '/ month' },
        { label: 'Grades 1 to 5', amount: 5500, per: '/ month' },
        { label: 'Grades 6 to 8', amount: 6500, per: '/ month' },
      ],
    },
    news: [
      { title: 'Nursery’s first harvest day', date: plusDays(today, -9), text: 'The youngest class dug up the carrots they planted in September and made soup for the whole school.' },
      { title: 'Grade 5 reads 400 books', date: plusDays(today, -21), text: 'The reading challenge ended with a trophy for the class and a pizza afternoon for the top readers.' },
    ],
    events: [
      { title: 'Meet the teachers', date: plusDays(today, 7), time: '4:00 pm', place: 'Main hall', kind: 'event' },
      { title: 'Term assessments', date: plusDays(today, 21), time: '', place: '', kind: 'exam' },
      { title: 'Show and tell showcase', date: plusDays(today, 28), time: '10:00 am', place: 'Main hall', kind: 'event' },
    ],
    faculty: [
      { name: 'Rukhsana Bibi', role: 'Principal', bio: 'Started as a Grade 1 teacher and still reads a story to Nursery every Friday.' },
      { name: 'Tariq Mehmood', role: 'Primary coordinator', bio: 'Makes mathematics feel like a treasure hunt.' },
      { name: 'Hina Akram', role: 'Nursery teacher', bio: 'Songs for every transition and a hug for every wobbly lip.' },
    ],
    testimonials: [
      { quote: 'My daughter runs to the gate every morning. I cannot ask for more than that.', name: 'Shazia Parveen', relation: 'Mother of a Nursery student' },
      { quote: 'The teachers know our children by name and notice when something is wrong.', name: 'Asif Raza', relation: 'Father of two' },
    ],
    contact: { address: 'Susan Road, Madina Town, Faisalabad', hours: 'Monday to Saturday, 8:00 am to 1:30 pm', whatsapp: '0301 5551234', facebook: 'https://facebook.com' },
    seo: { title: 'Bright Future School, Faisalabad', description: 'Bright Future School in Faisalabad: small classes from Nursery to Grade 8. Registration open.' },
  }),

  'online-academy': (today) => ({
    theme: { primary: '#be123c', accent: '#0ea5e9', font: 'geometric', scene: 'learning', corners: 'sharp', appearance: 'auto' },
    hero: {
      tagline: 'A complete school, online',
      headline: 'School at home that feels like school together',
      subheadline: 'Live classes with real teachers, clear homework and honest feedback for Grades 1 to 10, from anywhere in Pakistan.',
      notice: 'New batches start every month. Join a free demo class this week.',
    },
    about: {
      title: 'Built for online from day one',
      body: 'Virtual Learning Academy is not a school that moved online. It was designed for it: short, focused live lessons, a clear weekly timetable and teachers who know each student by name.\n\nStudents get recorded lessons, worksheets and quizzes in one place, and parents see progress without chasing anyone.',
      motto: 'Close the distance, keep the classroom.',
      values: [
        { title: 'Live and interactive', text: 'Every lesson is live with time for questions.', icon: 'laptop' },
        { title: 'One place for everything', text: 'Timetable, homework, recordings and results together.', icon: 'book' },
        { title: 'Parents in the loop', text: 'Weekly progress and instant alerts for missed work.', icon: 'shield' },
        { title: 'Support when stuck', text: 'Doubt sessions every evening with a subject teacher.', icon: 'bulb' },
      ],
    },
    programs: [
      { title: 'Primary online', ages: 'Grades 1 to 5', text: 'Short lessons, lots of activity and daily reading practice with a class teacher.', icon: 'book' },
      { title: 'Middle online', ages: 'Grades 6 to 8', text: 'Subject specialists, virtual labs and fortnightly projects.', icon: 'atom' },
      { title: 'Secondary online', ages: 'Grades 9 and 10', text: 'Board-aligned courses with weekly mock tests and doubt sessions.', icon: 'calculator' },
      { title: 'Coding club', ages: 'Grades 5 to 10', text: 'Build games and websites with a mentor, one evening a week.', icon: 'laptop' },
    ],
    admissions: {
      intro: 'Book a free demo class, then enrol in a few steps. All you need is a device and an internet connection.',
      requirements: ['Child’s B-form or birth certificate', 'Last report card', 'A laptop, tablet or phone with internet', 'Parent or guardian phone number'],
      deadline: 'Next batch starts on the 1st of the month',
    },
    fees: {
      note: 'No transport, no uniform. Fees can be paid online by JazzCash, Easypaisa or 1Bill.',
      rows: [
        { label: 'Enrolment (once)', amount: 5000, per: '' },
        { label: 'Primary online', amount: 6000, per: '/ month' },
        { label: 'Middle online', amount: 7500, per: '/ month' },
        { label: 'Secondary online', amount: 9000, per: '/ month' },
      ],
    },
    news: [
      { title: 'Grade 10 mock exams: results are in', date: plusDays(today, -4), text: 'Average scores rose eight points since September, with the biggest gains in mathematics.' },
      { title: 'Recorded lessons now have chapters', date: plusDays(today, -14), text: 'Students can jump straight to the part of a lesson they need to revisit.' },
    ],
    events: [
      { title: 'Free demo class', date: plusDays(today, 3), time: '5:00 pm', place: 'Online', kind: 'event' },
      { title: 'Grade 9 and 10 mock tests', date: plusDays(today, 15), time: '', place: 'Online', kind: 'exam' },
      { title: 'National holiday', date: plusDays(today, 22), time: '', place: '', kind: 'holiday' },
    ],
    faculty: [
      { name: 'Dr Saima Rehman', role: 'Head of Academics', bio: 'PhD in education technology and a fan of well-timed pauses in lessons.' },
      { name: 'Umair Farooq', role: 'Physics and Maths', bio: 'Explains with drawings, never slides.' },
      { name: 'Mariam Zafar', role: 'English', bio: 'Reads aloud every day because stories travel well on video.' },
      { name: 'Hamza Tariq', role: 'Computer Science', bio: 'Runs the coding club and a very patient doubt session.' },
    ],
    testimonials: [
      { quote: 'We live far from any good school. Now my son has teachers he can ask anything.', name: 'Zubair Anwar', relation: 'Father of a Grade 8 student' },
      { quote: 'The timetable and the homework tracker keep us organised. I can see everything from my phone.', name: 'Rabia Naeem', relation: 'Mother of a Grade 4 student' },
    ],
    faq: [
      { q: 'Do I need special equipment?', a: 'A laptop, tablet or a recent phone with a steady internet connection is enough.' },
      { q: 'Are lessons live or recorded?', a: 'Live, with a recording afterwards for anyone who missed it or wants to revise.' },
      { q: 'How does my child take exams?', a: 'Weekly quizzes and monthly tests happen online. Board exam preparation includes full mock papers.' },
    ],
    contact: { address: 'Office 804, Emerald Tower, Clifton Block 5, Karachi', hours: 'Monday to Friday, 9:00 am to 6:00 pm', whatsapp: '0302 9876543', instagram: 'https://instagram.com', youtube: 'https://youtube.com' },
    seo: { title: 'Virtual Learning Academy', description: 'Live online school for Grades 1 to 10 across Pakistan: real teachers, clear homework, honest feedback.' },
  }),
};

/** Publishes the demo site for a school; a site someone already edited is left as it is. */
export async function seedSite(prisma: PrismaClient, slug: string, today: string) {
  const content = CONTENT[slug];
  const school = await prisma.school.findUnique({ where: { slug }, select: { id: true } });
  if (!content || !school) return false;
  if (await prisma.schoolSite.findUnique({ where: { schoolId: school.id } })) return false;
  await prisma.schoolSite.create({ data: { schoolId: school.id, published: true, config: content(today) } });
  return true;
}
