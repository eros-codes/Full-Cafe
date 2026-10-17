import './page.css';
import { mount } from '../../shared/mount';
import { AboutPage } from './AboutPage';

// پیش از اولین رندر: استایل‌های «ظاهر شدن هنگام اسکرول» فقط وقتی جاوااسکریپت فعال است اعمال می‌شوند
document.body.classList.add('js-ready');

mount(<AboutPage />);
