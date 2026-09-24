import styles from './Logo.module.css'

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className={styles.logo}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} width={size} height={size} alt="" />
      <span className={styles.word}>Foyer</span>
    </span>
  )
}
