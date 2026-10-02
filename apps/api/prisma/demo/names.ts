// Names and wording for the demo schools: common in Pakistan, made up as people.

export const BOY_NAMES = [
  'Ahmed', 'Ali', 'Hassan', 'Hussain', 'Muhammad', 'Abdullah', 'Hamza', 'Bilal', 'Usman', 'Umar',
  'Saad', 'Zain', 'Ayaan', 'Rayyan', 'Arham', 'Haris', 'Talha', 'Shayan', 'Danish', 'Faizan',
  'Ibrahim', 'Yousuf', 'Musa', 'Taha', 'Ammar', 'Fahad', 'Hadi', 'Saim', 'Rohaan', 'Zaid',
  'Arsalan', 'Daniyal', 'Huzaifa', 'Moiz', 'Abdul Rehman', 'Shahzaib', 'Wahaj', 'Azan', 'Mustafa', 'Junaid',
];

export const GIRL_NAMES = [
  'Fatima', 'Ayesha', 'Zainab', 'Maryam', 'Hira', 'Aiza', 'Eman', 'Hoorain', 'Anaya', 'Areeba',
  'Mahnoor', 'Iqra', 'Laiba', 'Alishba', 'Khadija', 'Amna', 'Sana', 'Hafsa', 'Mehwish', 'Noor',
  'Rida', 'Zoya', 'Abeeha', 'Haniya', 'Inaya', 'Javeria', 'Minahil', 'Rania', 'Sidra', 'Umaima',
  'Wajiha', 'Dua', 'Fiza', 'Momina', 'Esha', 'Mishal', 'Hareem', 'Arfa', 'Kinza', 'Natasha',
];

export const SURNAMES = [
  'Khan', 'Ali', 'Ahmed', 'Malik', 'Butt', 'Sheikh', 'Chaudhry', 'Raza', 'Hussain', 'Iqbal',
  'Qureshi', 'Siddiqui', 'Mirza', 'Javed', 'Aslam', 'Akhtar', 'Rana', 'Bhatti', 'Awan', 'Abbasi',
  'Hashmi', 'Rizvi', 'Naqvi', 'Gondal', 'Cheema', 'Warraich', 'Saleem', 'Tariq', 'Nadeem', 'Farooq',
];

export const FATHER_NAMES = [
  'Imran', 'Asif', 'Tariq', 'Kashif', 'Naveed', 'Shahid', 'Khalid', 'Farhan', 'Adnan', 'Waqas',
  'Zeeshan', 'Kamran', 'Rizwan', 'Faisal', 'Nadeem', 'Atif', 'Sajid', 'Amir', 'Salman', 'Junaid',
  'Babar', 'Nasir', 'Shoaib', 'Arshad', 'Rashid', 'Majid', 'Haroon', 'Irfan', 'Mubashir', 'Qasim',
];

export const MOTHER_NAMES = [
  'Sadia', 'Saima', 'Nadia', 'Rabia', 'Sana', 'Uzma', 'Asma', 'Bushra', 'Farah', 'Huma',
  'Lubna', 'Maria', 'Nabila', 'Rubina', 'Samina', 'Shazia', 'Tahira', 'Ambreen', 'Fozia', 'Kiran',
];

export const OCCUPATIONS = [
  'Businessman', 'Shopkeeper', 'Engineer', 'Doctor', 'Teacher', 'Banker', 'Government employee',
  'Driver', 'Software developer', 'Accountant', 'Army officer', 'Contractor', 'Pharmacist', 'Lawyer',
];

export const STREETS = [
  'Model Town', 'Faisal Town', 'Johar Town', 'Township', 'Garden Town', 'Iqbal Town', 'Wapda Town',
  'Gulberg III', 'Samanabad', 'Allama Iqbal Town', 'Valencia Town', 'Green Town',
];

export const TEACHER_TITLES: Record<string, string> = {
  English: 'English teacher',
  Urdu: 'Urdu teacher',
  Mathematics: 'Mathematics teacher',
  Science: 'Science teacher',
  Islamiat: 'Islamiat teacher',
  'Social Studies': 'Social Studies teacher',
  Computer: 'Computer teacher',
  'Nazra Quran': 'Qari',
};

export const HOMEWORK: Record<string, string[]> = {
  English: [
    'Write ten sentences using the new vocabulary words',
    'Read the story on page {p} and answer the questions',
    'Write a paragraph on "My Favourite Season"',
    'Learn the spellings of lesson {n}',
    'Complete the grammar worksheet on tenses',
  ],
  Urdu: [
    'سبق {n} کے سوالات کے جواب لکھیں',
    'Write the poem from page {p} neatly in the notebook',
    'Learn the words of lesson {n} with meanings',
    'Write an essay "میرا پیارا پاکستان"',
  ],
  Mathematics: [
    'Exercise {n}.{m}, questions 1 to 10',
    'Learn tables 2 to {t}',
    'Solve the word problems on page {p}',
    'Revise fractions for Friday’s test',
    'Exercise {n}.{m}, all parts',
  ],
  Science: [
    'Draw and label the parts of a plant',
    'Answer the questions at the end of chapter {n}',
    'Learn the definitions from chapter {n}',
    'Collect five different leaves for the class activity',
  ],
  Islamiat: [
    'Learn the translation of Surah Al-Fatiha',
    'Write five qualities of the Holy Prophet (PBUH)',
    'Answer the questions of lesson {n}',
  ],
  'Social Studies': [
    'Mark the provinces of Pakistan on the map',
    'Answer the questions of chapter {n}',
    'Write five lines about the Quaid-e-Azam',
  ],
  Computer: [
    'Label the parts of a computer',
    'Learn the shortcut keys from page {p}',
    'Answer the questions of chapter {n}',
  ],
  'Nazra Quran': ['Revise the lesson taught today', 'Practise the next page of Qaida'],
};

export const TEACHER_REMARKS = {
  high: [
    'Excellent work throughout the term. Keep it up!',
    'A bright and hard-working student.',
    'Outstanding performance and very attentive in class.',
  ],
  mid: [
    'Good effort. Can do even better with regular revision.',
    'Steady progress; should take more part in class.',
    'Satisfactory work. Needs to improve handwriting.',
  ],
  low: [
    'Needs to work much harder, especially in weak subjects.',
    'Irregular in homework; parents are requested to meet the class teacher.',
    'Has potential but needs daily practice at home.',
  ],
};
