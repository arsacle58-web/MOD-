import { EntityDamageCause, EquipmentSlot, GameMode, ItemLockMode, ItemStack, system, world } from "@minecraft/server";

const airBlocks = ["minecraft:air", "minecraft:fern", "minecraft:large_fern", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:nether_sprouts", "minecraft:crimson_roots", "minecraft:warped_roots", "minecraft:snow_layer", "minecraft:vine", "minecraft:water"];

const invisibleBlocks = [ "minecraft:ladder", "minecraft:scaffolding", "minecraft:torch", "minecraft:copper_torch", "minecraft:soul_torch", "minecraft:redstone_torch", "minecraft:acacia_sapling", "minecraft:birch_sapling", "minecraft:cherry_sapling", "minecraft:dark_oak_sapling", "minecraft:jungle_sapling", "minecraft:oak_sapling", "minecraft:pale_oak_sapling", "minecraft:spruce_sapling", "minecraft:wheat", "minecraft:potatoes", "minecraft:carrots", "minecraft:beetroot", "minecraft:melon_stem", "minecraft:pumpkin_stem", "minecraft:sweet_berry_bush", "minecraft:glow_berries", "minecraft:fern", "minecraft:large_fern", "minecraft:seagrass", "minecraft:short_dry_grass", "minecraft:short_grass", "minecraft:tall_dry_grass", "minecraft:tall_grass", "minecraft:vine", "minecraft:twisting_vines", "minecraft:weeping_vines", "minecraft:web", "minecraft:crimson_roots", "minecraft:hanging_roots", "minecraft:warped_roots", "minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:orange_tulip", "minecraft:pink_tulip", "minecraft:red_tulip", "minecraft:white_tulip", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:sunflower", "minecraft:lilac", "minecraft:rose_bush", "minecraft:whiter_rose", "minecraft:peony", "minecraft:pitcher_plant", "minecraft:torchflower", "minecraft:closed_eyeblossom", "minecraft:open_eyeblossom" ];

function decrementItemInInventory(entity, slot, options = {}) {
	const { amount = 1, inCreative = false, convertTo = undefined } = options;
	if (entity.typeId === "minecraft:player" && entity?.getGameMode() === GameMode.Creative && !inCreative) return;
	const inventory = entity.getComponent("inventory")?.container;
	if (!inventory) return;
	const item = inventory.getItem(slot);
	if (!item) return;
	if (item.amount > amount) {
		item.amount -= amount;
		inventory.setItem(slot, item);
	} else inventory.setItem(slot, convertTo);
}
system.beforeEvents.startup.subscribe((i) => {
	i.itemComponentRegistry.registerCustomComponent("arsenal:gun", {
		onUse: async (e, p) => {
            const { source: player, itemStack } = e;
			if(!player.getDynamicProperty("arsenal_reloading")) {
                ArsenalWeaponSystem.startFiring(player, itemStack, p.params);
            }
            /*
            {
                damage: 8,
                damageAds: 10,
                projectile: "awm:scope",
                projectileAds: "awm:noscope",
                fire_rate: 15,
                max_distance: 160,
                max_ammo: 50,
                spread: 0,
                spreadAds: 0,
				sound: "addon.rvl34",
                camerashake: "0.13 0.1 rotational",
                camerashakeAds: "0.13 0.1 rotational"
            }
            */
		}
	});
    i.itemComponentRegistry.registerCustomComponent("arsenal:reload", {
        onUse: async (e, p) => {
            const { source: player, itemStack } = e;
            const reloadTime = p.params.reload_time;
            const sound = p.params.sound;
            const ammo = p.params.ammo;
            
            const inventory = player.getComponent("inventory").container;
            let ammoFound = false;
            let ammoSlot = -1;
            for (let i = 0; i < inventory.size; i++) {
                const item = inventory.getItem(i);
                if (item && item.typeId === ammo) {
                    ammoFound = true;
                    ammoSlot = i;
                    break;
                }
            }
            if (!ammoFound) {
                player.onScreenDisplay.setActionBar({ translate: "actiobar.arsenal.no_ammo" });
                return;
            }
            player.playSound(sound, player.location);
            system.runTimeout(() => {
                if (!player.isValid) return;
                const currentItem = player.getComponent("inventory").container.getItem(player.selectedSlotIndex);
                if (!currentItem || currentItem.typeId !== itemStack.typeId) return;
                decrementItemInInventory(player, ammoSlot);
                const loadedItemId = itemStack.typeId.replace("_empty", "");
                const loadedItem = new ItemStack(loadedItemId, 1);

                const inv = player.getComponent("inventory").container;
                inv.setItem(player.selectedSlotIndex, loadedItem);
                
                //player.sendMessage("Recargado :)");
                
            }, reloadTime * 20);
        }
    });
});

function addSpread(dir, amount) {
	return {
		x: dir.x + (Math.random() - 0.5) * amount,
		y: dir.y + (Math.random() - 0.5) * amount,
		z: dir.z + (Math.random() - 0.5) * amount,
	};
}
function normalize(v) {
	const l = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
	return { x: v.x/l, y: v.y/l, z: v.z/l };
}
function computeFalloff(distance, maxRange, power = 1.4) {
	const t = distance / maxRange;
	if (t >= 1) return 0;
	return 1 - Math.pow(t, power);
}
class ArsenalWeaponSystem {
    static activeWeapons = new Map();
    
    static startFiring(player, item, params) {
        const playerId = player.id;
        
        if (this.activeWeapons.has(playerId)) {
            this.stopFiring(player);
        }
        
        const originalItemId = item.typeId;
        player.setDynamicProperty("arsenal_original_item_id", originalItemId);
        player.setDynamicProperty("arsenal_selected_index", Number(player.selectedSlotIndex));
        
        const fireRate = params.fire_rate;
        const damage = params.damage || 1;
        const damageAds = params.damageAds || params.damage;
        const projectile = params.projectile || "awm:scope";
        const projectileAds = params.projectileAds || params.projectile || "awm:scope";
        const maxDistance = params.max_distance || 1;
        const maxAmmo = params.max_ammo;
        const spread = params.spread || 0;
        const spreadAds = params.spreadAds || 0;
        const cameraShake = params.camerashake;
        const cameraShakeAds = params.camerashakeAds;
        const pellets = params.pellets || 1;
        const sound = params.sound || "";
        
        const currentAmmo = Math.min(item.getDynamicProperty("ammo") ?? maxAmmo, maxAmmo);
        player.setDynamicProperty("arsenal_ammo", currentAmmo);
        player.setDynamicProperty("arsenal_max_ammo", maxAmmo);
        player.setDynamicProperty("arsenal_right_click", true);
        player.setDynamicProperty("arsenal_shot_count", 0);
        
        if (player.getDynamicProperty("arsenal_right_click")) {
            const ammo = player.getDynamicProperty("arsenal_ammo");
            
            if(ammo > 0) {
                player.setDynamicProperty("arsenal_ammo", ammo - 1);
                
                const isAiming = player.isSneaking;
                const actualDamage = isAiming ? damageAds : damage;
                const actualSpread = isAiming ? spreadAds : spread;
                const actualCameraShake = isAiming ? cameraShakeAds : cameraShake;
                const actualProjectile = isAiming ? projectileAds : projectile;
                
                this.updateAmmoDisplay(player);
                this.fireWithProjectiles(player, ammo, actualProjectile, actualCameraShake, isAiming, sound);
                /*if (fireRate < 10) {
                    this.fireWithProjectiles(player, ammo, actualProjectile, actualCameraShake, isAiming, sound);
                } else {
                    this.fireWithHitscan(player, ammo, actualDamage, maxDistance, pellets, actualSpread, actualCameraShake, sound);
                }*/
            } else {
                this.replaceWithEmptyWeapon(player);
                this.stopFiring(player);
                return;
            }
        }
        let runId;
        runId = system.runInterval(() => {
            item?.getComponent("cooldown").startCooldown(player);
            this.weaponLoopProjectile(player, damage, damageAds, maxDistance, pellets, fireRate, projectile, projectileAds, spread, spreadAds, cameraShake, cameraShakeAds, sound);
        }, fireRate);
        /*if (fireRate < 10) {
            runId = system.runInterval(() => {
                item?.getComponent("cooldown").startCooldown(player);
                this.weaponLoopProjectile(player, damage, damageAds, maxDistance, pellets, fireRate, projectile, projectileAds, spread, spreadAds, cameraShake, cameraShakeAds, sound);
            }, fireRate);
        } else {
            runId = system.runInterval(() => {
                item?.getComponent("cooldown").startCooldown(player);
                this.weaponLoopHitscan(player, damage, damageAds, maxDistance, pellets, fireRate, spread, spreadAds, cameraShake, cameraShakeAds, sound);
            }, fireRate);
        }*/
        
        this.activeWeapons.set(playerId, runId);
    }
    static fireWithHitscan(player, ammo, damage, maxDistance, pellets = 1, spread = 0, cameraShake, sound) {
        player.dimension.playSound(sound, player.getHeadLocation());
        const baseDir = player.getViewDirection();
        const damageMap = new Map();

        for (let i = 0; i < pellets; i++) {
            const dir = spread > 0 ? normalize(addSpread(baseDir, spread)) : baseDir;

            const hits = player.dimension.getEntitiesFromRay(
                player.getHeadLocation(),
                dir,
                { maxDistance, includePassableBlocks: true, excludeNames: [player.name], excludeTypes: ["minecraft:item", "minecraft:area_effect_cloud"]}
            );

            if (hits.length > 0) {
                const hit = hits[0];
                const entity = hit.entity;
                const dist = hit.distance;
                
                if (entity && entity.isValid) {
                    const fall = computeFalloff(dist, maxDistance, 1.4);
                    const finalDamage = damage * fall;
                    const current = damageMap.get(entity) ?? 0;
                    damageMap.set(entity, current + finalDamage);
                }
            }
        }
        for (const [entity, totalDamage] of damageMap.entries()) {
            const finalDamage = Math.max(1, Math.round(totalDamage));
            entity.applyDamage(finalDamage, {
                damagingEntity: player,
                cause: EntityDamageCause.entityAttack
            });
        }
        player.runCommand(`camerashake add @s ${cameraShake}`);
        if(ammo <= 1) {
            this.replaceWithEmptyWeapon(player);
            this.stopFiring(player);
            return;
        }
    }
    static fireWithProjectiles(player, ammo, bulletEvent, cameraShake, isAiming = false, sound) {
        player.dimension.playSound(sound, player.getHeadLocation());
        const dir = player.getViewDirection();
        const rotation = player.getRotation();
        
        const headLoc = player.getHeadLocation();
        let spawnOffset = 1.0;
        if (rotation.x >= 70 && rotation.x < 75) {
            spawnOffset = 1.7;
        } else if (rotation.x >= 75 && rotation.x < 80) {
            spawnOffset = 2.2;
        } else if (rotation.x >= 80 && rotation.x <= 90) {
            spawnOffset = 2.5;
        }
        const spawnLocation = {
            x: headLoc.x + (dir.x * spawnOffset),
            y: headLoc.y + (dir.y * spawnOffset),
            z: headLoc.z + (dir.z * spawnOffset)
        };
        const bullet = player.dimension.spawnEntity("arsenal:bullet", spawnLocation);
        bullet.triggerEvent(bulletEvent);
        
        const speed = 500;
        const velocity = {
            x: dir.x * speed,
            y: dir.y * speed,
            z: dir.z * speed
        };
        bullet.applyImpulse(velocity);
        
        player.runCommand(`camerashake add @s ${cameraShake}`);
        if(ammo <= 1) {
            this.replaceWithEmptyWeapon(player);
            this.stopFiring(player);
            return;
        }
    }

    static stopFiring(player) {
        const playerId = player.id;
        const runId = this.activeWeapons.get(playerId);
        
        if (runId) {
            system.clearRun(runId);
            this.activeWeapons.delete(playerId);
        }
        player.setDynamicProperty("arsenal_right_click", undefined);
        player.setDynamicProperty("arsenal_shot_count", undefined);
        player.setDynamicProperty("arsenal_ammo", undefined);
        player.setDynamicProperty("arsenal_max_ammo", undefined);
        player.setDynamicProperty("arsenal_original_item_id", undefined);
        player.setDynamicProperty("arsenal_selected_index", undefined);
    }
    static replaceWithEmptyWeapon(player) {
        const originalItemId = player.getDynamicProperty("arsenal_original_item_id");
        if (!originalItemId) return;
        const selectedIndex = player.getDynamicProperty("arsenal_selected_index");
        const item = player.getComponent("inventory").container.getItem(player.selectedSlotIndex);
        if (selectedIndex === undefined || selectedIndex !== player.selectedSlotIndex || item?.typeId !== originalItemId) return;
        const emptyItemId = `${originalItemId}_empty`;
        const emptyItem = new ItemStack(emptyItemId, 1);

        const inv = player.getComponent("inventory").container;
        inv.setItem(player.selectedSlotIndex, emptyItem);
        
        //player.sendMessage("No hay balas :)");
    }
    static weaponLoopProjectile(player, damage, damageAds, maxDistance, pellets, fireRate, projectile, projectileAds, spread, spreadAds, cameraShake, cameraShakeAds, sound) {
        if(!player || !player.isValid || !player.getDynamicProperty("arsenal_right_click")) {
            this.stopFiring(player);
            return;
        }
        
        const ammo = player.getDynamicProperty("arsenal_ammo");
        const isAiming = player.isSneaking;
        const actualProjectile = isAiming ? projectileAds : projectile;
        const actualCameraShake = isAiming ? cameraShakeAds : cameraShake;
        
        this.updateAmmoAndCount(player);
        this.fireWithProjectiles(player, ammo, actualProjectile, actualCameraShake, isAiming, sound);
    }
    static weaponLoopHitscan(player, damage, damageAds, maxDistance, pellets, fireRate, spread, spreadAds, cameraShake, cameraShakeAds, sound) {
        if(!player || !player.isValid || !player.getDynamicProperty("arsenal_right_click")) {
            this.stopFiring(player);
            return;
        }
        
        const ammo = player.getDynamicProperty("arsenal_ammo");

        const isAiming = player.isSneaking;
        const actualDamage = isAiming ? damageAds : damage;
        const actualSpread = isAiming ? spreadAds : spread;
        const actualCameraShake = isAiming ? cameraShakeAds : cameraShake;
        
        this.updateAmmoAndCount(player);
        this.fireWithHitscan(player, ammo, actualDamage, maxDistance, pellets, actualSpread, actualCameraShake, sound);
    }
    static updateAmmoAndCount(player) {
        const currentAmmo = player.getDynamicProperty("arsenal_ammo");
        player.setDynamicProperty("arsenal_ammo", currentAmmo - 1);
        const shotCount = player.getDynamicProperty("arsenal_shot_count") ?? 0;
        player.setDynamicProperty("arsenal_shot_count", shotCount + 1);
        if (shotCount > 100) {
            this.stopFiring(player);
            return;
        }
        this.updateAmmoDisplay(player);
    }
    static updateAmmoDisplay(player) {
        const ammo = player.getDynamicProperty("arsenal_ammo");
        const maxAmmo = player.getDynamicProperty("arsenal_max_ammo");
        if (ammo !== undefined && maxAmmo !== undefined) {
            player.onScreenDisplay.setActionBar({ translate: "actionbar.arsenal.ammo", with: [ `${ammo} / ${maxAmmo}` ] });
        }
    }
}
let tick = 0;
system.runTimeout(() => {
    system.runInterval(() => {
        tick ++;
        for (const player of world.getPlayers()) {
            if (!player.isValid) continue;
            const item = player.getComponent("equippable").getEquipment(EquipmentSlot.Mainhand);
            if (!item) continue;
            if (item.typeId === "arsenal:awm" && player.isSneaking && !player.hasTag("arsenal:zoom")) {
                player.addTag("arsenal:zoom");
                player.addEffect("slowness", 2000000, { amplifier: 7, showParticles: false });
            } else if (player.hasTag("arsenal:zoom") && (!player.isSneaking || item.typeId !== "arsenal:awm")) {
                player.removeTag("arsenal:zoom");
                player.removeEffect("slowness");
            }
            if (tick % 5 === 0) {
                if (item.hasTag("arsenal:two_hands")) {
                    player.playAnimation("animation.arsenal.2_hands.third_person", { stopExpression: "!q.equipped_item_any_tag('slot.weapon.mainhand','arsenal:two_hands')" });
                } else if (item.hasTag("arsenal:one_hand")) {
                    player.playAnimation("animation.arsenal.1_hand.third_person", { stopExpression: "!q.equipped_item_any_tag('slot.weapon.mainhand','arsenal:one_hand')" });
                }
                tick = 0;
            }
        }
    }, 1);
}, 20);
world.afterEvents.itemStopUse.subscribe((e) => {
    if (e.itemStack.hasTag("arsenal:arsenal_gun")) {
        const { source: player, itemStack: item } = e;
        
        const currentAmmo = player.getDynamicProperty("arsenal_ammo");
        const maxAmmo = player.getDynamicProperty("arsenal_max_ammo");
        
    
        const selectedIndex = player.getDynamicProperty("arsenal_selected_index");
        if (item && player.isValid && currentAmmo !== undefined && maxAmmo !== undefined && selectedIndex !== undefined) {
            const itemIndex = player.getComponent("inventory").container.getItem(selectedIndex);
            if (itemIndex?.typeId !== player.getDynamicProperty("arsenal_original_item_id")) return;
            const clampedAmmo = Math.min(currentAmmo, maxAmmo);
            
            item.setDynamicProperty("ammo", clampedAmmo);
            item.setLore([`§7Ammo: ${clampedAmmo} / ${maxAmmo}`]);
            
            const inv = player.getComponent("inventory").container;
            inv.setItem(selectedIndex, item);
            
            player.onScreenDisplay.setActionBar({ translate: "actionbar.arsenal.ammo", with: [ `${clampedAmmo} / ${maxAmmo}` ] });
        }
        ArsenalWeaponSystem.stopFiring(player);
        
        //player.sendMessage("stop");
    }
});
world.afterEvents.projectileHitEntity.subscribe((e) => {
    const projectile = e.projectile;
    if (!projectile.isValid) return;
    if (!projectile.matches({ type: "arsenal:bullet" })) return;
    projectile.remove();
});
world.afterEvents.projectileHitBlock.subscribe((e) => {
    const projectile = e.projectile;
    if (!projectile.isValid) return;
    if (!projectile.matches({ type: "arsenal:bullet" })) return;
    if (!e?.getBlockHit()?.block?.isValid) return;
    projectile.dimension.playSound("arsenal:bullet_hit", projectile.location);
    projectile.dimension.spawnParticle("arsenal:bullet_hit_block", projectile.location);
    projectile.remove();
});
world.afterEvents.entityDie.subscribe((e) => {
    const player = e.deadEntity;

    if (!player.matches({ type: "minecraft:player" })) return;
    if (!player.isValid) return;

    const equippable = player.getComponent("equippable");
    const item = equippable.getEquipment(EquipmentSlot.Mainhand);
    if (!item) return ArsenalWeaponSystem.stopFiring(player);
    if (!item.hasTag("arsenal:arsenal_gun")) return;

    const currentAmmo = player.getDynamicProperty("arsenal_ammo");
    const maxAmmo = player.getDynamicProperty("arsenal_max_ammo");
    const selectedIndex = player.getDynamicProperty("arsenal_selected_index");
    const originalId = player.getDynamicProperty("arsenal_original_item_id");

    if (currentAmmo === undefined || maxAmmo === undefined || selectedIndex === undefined || !originalId) return;

    const inv = player.getComponent("inventory")?.container;
    if (!inv) return;

    const invItem = inv.getItem(selectedIndex);
    if (!invItem || invItem.typeId !== originalId) return;

    const clampedAmmo = Math.min(currentAmmo, maxAmmo);

    invItem.setDynamicProperty("ammo", clampedAmmo);
    invItem.setLore([`§7Ammo: ${clampedAmmo} / ${maxAmmo}`]);
    inv.setItem(selectedIndex, invItem);

    ArsenalWeaponSystem.stopFiring(player);
})