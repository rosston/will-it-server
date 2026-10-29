import { Todos } from './components/Todos'
import styles from './page.module.css'

export default function Home () {
  return (
    <div className={styles.page}>
      <Todos />
    </div>
  )
}
